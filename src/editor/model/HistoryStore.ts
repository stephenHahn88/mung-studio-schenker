import { Atom, atom, getDefaultStore, PrimitiveAtom } from "jotai";
import { Node } from "../../mung/Node";
import { NotationGraphStore } from "./notation-graph-store/NotationGraphStore";
import { JotaiStore } from "./JotaiStore";
import { isTimeGroupKey, TimeGroupPatch } from "../../mung/TimeGroups";

type GroupFieldChange = {
  nodeId: number;
  key: string;
  before: Node["data"][string] | null;
  after: Node["data"][string] | null;
};
type HistoryEntry =
  | { kind: "snapshot"; before: HistorySnapshot; after: HistorySnapshot }
  | { kind: "timeGroups"; changes: readonly GroupFieldChange[] };

type HistorySnapshot = readonly Node[];

const MAX_HISTORY_SIZE = 100;

/**
 * Undo/redo history of the notation graph. Edits made in the same microtask
 * form one history entry.
 */
export class HistoryStore {
  private readonly notationGraphStore: NotationGraphStore;
  private readonly jotaiStore: JotaiStore;

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private currentSnapshot: HistorySnapshot;

  private isApplyingSnapshot = false;
  private isSnapshotScheduled = false;

  constructor(
    notationGraphStore: NotationGraphStore,
    jotaiStore: JotaiStore | null = null,
  ) {
    this.notationGraphStore = notationGraphStore;
    this.jotaiStore = jotaiStore ?? getDefaultStore();
    this.currentSnapshot = this.takeSnapshot();

    this.notationGraphStore.onChange.subscribe(() => {
      if (
        this.isApplyingSnapshot ||
        this.notationGraphStore.isApplyingTimeGroupPatches
      )
        return;
      this.scheduleSnapshot();
    });

    this.notationGraphStore.onBeforeTimeGroupPatches.subscribe(() => {
      if (!this.isApplyingSnapshot) this.flushScheduledSnapshot();
    });
    this.notationGraphStore.onAfterTimeGroupPatches.subscribe(({ remote }) => {
      if (this.isApplyingSnapshot) return;
      if (remote) {
        // remote time-group changes are not undo items
        this.currentSnapshot = this.takeSnapshot();
      } else {
        this.recordCurrentSnapshot();
      }
    });

    this.updateAtoms();
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(): boolean {
    this.flushScheduledSnapshot();
    if (!this.canUndo) return false;

    const entry = this.undoStack.pop()!;
    const applied = this.applyEntry(entry, false);
    if (applied !== null) this.redoStack.push(applied);
    this.currentSnapshot = this.takeSnapshot();
    this.updateAtoms();
    return true;
  }

  public redo(): boolean {
    this.flushScheduledSnapshot();
    if (!this.canRedo) return false;

    const entry = this.redoStack.pop()!;
    const applied = this.applyEntry(entry, true);
    if (applied !== null) this.undoStack.push(applied);
    this.currentSnapshot = this.takeSnapshot();
    this.updateAtoms();
    return true;
  }

  private applyEntry(
    entry: HistoryEntry,
    forward: boolean,
  ): HistoryEntry | null {
    if (entry.kind === "snapshot") {
      this.applySnapshot(forward ? entry.after : entry.before);
      return entry;
    }
    const patches: TimeGroupPatch[] = [];
    const applied: GroupFieldChange[] = [];
    for (const change of entry.changes) {
      if (!this.notationGraphStore.hasNode(change.nodeId)) continue;
      const current =
        this.notationGraphStore.getNode(change.nodeId).data[change.key] ?? null;
      const expected = forward ? change.before : change.after;
      // skip fields that have changed since
      if (!this.areDataValuesEqual(current, expected)) continue;
      patches.push({
        nodeId: change.nodeId,
        data: { [change.key]: forward ? change.after : change.before },
      });
      applied.push(change);
    }
    if (patches.length === 0) return null;
    this.isApplyingSnapshot = true;
    try {
      this.notationGraphStore.applyTimeGroupPatches(patches);
    } finally {
      this.isApplyingSnapshot = false;
    }
    return { kind: "timeGroups", changes: applied };
  }

  private scheduleSnapshot(): void {
    if (this.isSnapshotScheduled) return;
    this.isSnapshotScheduled = true;
    queueMicrotask(() => this.flushScheduledSnapshot());
  }

  private flushScheduledSnapshot(): void {
    if (!this.isSnapshotScheduled) return;
    this.isSnapshotScheduled = false;
    this.recordCurrentSnapshot();
  }

  private recordCurrentSnapshot(): void {
    const nextSnapshot = this.takeSnapshot();
    if (this.areSnapshotsEqual(this.currentSnapshot, nextSnapshot)) {
      return;
    }

    const groupChanges = this.groupOnlyChanges(
      this.currentSnapshot,
      nextSnapshot,
    );
    this.undoStack.push(
      groupChanges === null
        ? {
            kind: "snapshot",
            before: this.currentSnapshot,
            after: nextSnapshot,
          }
        : { kind: "timeGroups", changes: groupChanges },
    );
    if (this.undoStack.length > MAX_HISTORY_SIZE) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.currentSnapshot = nextSnapshot;
    this.updateAtoms();
  }

  private applySnapshot(snapshot: HistorySnapshot): void {
    this.isApplyingSnapshot = true;
    try {
      // existing nodes keep their current time-group memberships
      const nodes = this.cloneSnapshot(snapshot).map((node) => {
        if (!this.notationGraphStore.hasNode(node.id)) return node;
        const data = { ...node.data };
        for (const key of Object.keys(data))
          if (isTimeGroupKey(key)) delete data[key];
        for (const [key, value] of Object.entries(
          this.notationGraphStore.getNode(node.id).data,
        )) {
          if (isTimeGroupKey(key)) data[key] = { ...value };
        }
        return { ...node, data };
      });
      this.notationGraphStore.setAllNodes(nodes);
    } finally {
      this.isApplyingSnapshot = false;
    }
  }

  private areDataValuesEqual(
    first: Node["data"][string] | null,
    second: Node["data"][string] | null,
  ): boolean {
    if (first === null || second === null) return first === second;
    return first.type === second.type && first.value === second.value;
  }

  private groupOnlyChanges(
    before: HistorySnapshot,
    after: HistorySnapshot,
  ): GroupFieldChange[] | null {
    if (before.length !== after.length) return null;
    const changes: GroupFieldChange[] = [];
    for (let i = 0; i < before.length; i++) {
      const first = before[i];
      const second = after[i];
      if (first.id !== second.id) return null;
      const withoutGroups = (data: Node["data"]) =>
        Object.fromEntries(
          Object.entries(data).filter(([key]) => !isTimeGroupKey(key)),
        );
      if (
        !this.areNodesEqual(
          { ...first, data: withoutGroups(first.data) },
          { ...second, data: withoutGroups(second.data) },
        )
      )
        return null;
      for (const key of new Set([
        ...Object.keys(first.data),
        ...Object.keys(second.data),
      ])) {
        if (!isTimeGroupKey(key)) continue;
        const oldValue = first.data[key] ?? null;
        const newValue = second.data[key] ?? null;
        if (!this.areDataValuesEqual(oldValue, newValue)) {
          changes.push({
            nodeId: first.id,
            key,
            before: oldValue,
            after: newValue,
          });
        }
      }
    }
    return changes;
  }

  private takeSnapshot(): HistorySnapshot {
    return this.cloneSnapshot(this.notationGraphStore.nodes);
  }

  private cloneSnapshot(snapshot: readonly Node[]): HistorySnapshot {
    return snapshot.map((node) => this.cloneNode(node));
  }

  private cloneNode(node: Node): Node {
    return {
      ...node,
      syntaxOutlinks: [...node.syntaxOutlinks],
      syntaxInlinks: [...node.syntaxInlinks],
      precedenceOutlinks: [...node.precedenceOutlinks],
      precedenceInlinks: [...node.precedenceInlinks],
      decodedMask:
        node.decodedMask === null
          ? null
          : this.cloneImageData(node.decodedMask),
      data: this.cloneDataItems(node.data),
      polygon: node.polygon === null ? null : [...node.polygon],
    };
  }

  private cloneImageData(imageData: ImageData): ImageData {
    return new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height,
    );
  }

  private cloneDataItems(data: Node["data"]): Node["data"] {
    const cloned: Node["data"] = {};
    for (const key in data) {
      cloned[key] = { ...data[key] };
    }
    return cloned;
  }

  private areSnapshotsEqual(
    first: HistorySnapshot,
    second: HistorySnapshot,
  ): boolean {
    if (first.length !== second.length) return false;

    for (let i = 0; i < first.length; i++) {
      if (!this.areNodesEqual(first[i], second[i])) return false;
    }

    return true;
  }

  private areNodesEqual(first: Node, second: Node): boolean {
    return (
      first.id === second.id &&
      first.className === second.className &&
      first.top === second.top &&
      first.left === second.left &&
      first.width === second.width &&
      first.height === second.height &&
      first.textTranscription === second.textTranscription &&
      this.areNumberArraysEqual(first.syntaxOutlinks, second.syntaxOutlinks) &&
      this.areNumberArraysEqual(first.syntaxInlinks, second.syntaxInlinks) &&
      this.areNumberArraysEqual(
        first.precedenceOutlinks,
        second.precedenceOutlinks,
      ) &&
      this.areNumberArraysEqual(
        first.precedenceInlinks,
        second.precedenceInlinks,
      ) &&
      this.areDataItemsEqual(first.data, second.data) &&
      this.areNullableNumberArraysEqual(first.polygon, second.polygon) &&
      this.areImageDataEqual(first.decodedMask, second.decodedMask)
    );
  }

  private areNumberArraysEqual(first: number[], second: number[]): boolean {
    if (first.length !== second.length) return false;
    for (let i = 0; i < first.length; i++) {
      if (first[i] !== second[i]) return false;
    }
    return true;
  }

  private areNullableNumberArraysEqual(
    first: number[] | null,
    second: number[] | null,
  ): boolean {
    if (first === null || second === null) return first === second;
    return this.areNumberArraysEqual(first, second);
  }

  private areDataItemsEqual(
    first: Node["data"],
    second: Node["data"],
  ): boolean {
    const firstKeys = Object.keys(first).sort();
    const secondKeys = Object.keys(second).sort();
    if (!this.areStringArraysEqual(firstKeys, secondKeys)) return false;

    for (const key of firstKeys) {
      if (first[key].type !== second[key].type) return false;
      if (first[key].value !== second[key].value) return false;
    }

    return true;
  }

  private areStringArraysEqual(first: string[], second: string[]): boolean {
    if (first.length !== second.length) return false;
    for (let i = 0; i < first.length; i++) {
      if (first[i] !== second[i]) return false;
    }
    return true;
  }

  private areImageDataEqual(
    first: ImageData | null,
    second: ImageData | null,
  ): boolean {
    if (first === null || second === null) return first === second;
    if (first.width !== second.width || first.height !== second.height) {
      return false;
    }
    if (first.data.length !== second.data.length) return false;
    for (let i = 0; i < first.data.length; i++) {
      if (first.data[i] !== second.data[i]) return false;
    }
    return true;
  }

  private canUndoBaseAtom: PrimitiveAtom<boolean> = atom(false);
  private canRedoBaseAtom: PrimitiveAtom<boolean> = atom(false);

  public canUndoAtom: Atom<boolean> = atom((get) => get(this.canUndoBaseAtom));
  public canRedoAtom: Atom<boolean> = atom((get) => get(this.canRedoBaseAtom));

  private updateAtoms(): void {
    this.jotaiStore.set(this.canUndoBaseAtom, this.canUndo);
    this.jotaiStore.set(this.canRedoBaseAtom, this.canRedo);
  }
}
