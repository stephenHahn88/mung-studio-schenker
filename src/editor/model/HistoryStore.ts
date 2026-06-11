import { Atom, atom, getDefaultStore, PrimitiveAtom } from "jotai";
import { Node } from "../../mung/Node";
import { NotationGraphStore } from "./notation-graph-store/NotationGraphStore";
import { JotaiStore } from "./JotaiStore";

type HistorySnapshot = readonly Node[];

const MAX_HISTORY_SIZE = 100;

/**
 * Snapshot-based undo/redo history for notation graph changes.
 *
 * Graph operations often perform multiple synchronous node/link edits in a
 * row. The history store records at the end of the current microtask so those
 * edits become a single undoable operation.
 */
export class HistoryStore {
  private readonly notationGraphStore: NotationGraphStore;
  private readonly jotaiStore: JotaiStore;

  private undoStack: HistorySnapshot[] = [];
  private redoStack: HistorySnapshot[] = [];
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
      if (this.isApplyingSnapshot) return;
      this.scheduleSnapshot();
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

    const previousSnapshot = this.undoStack.pop()!;
    this.redoStack.push(this.currentSnapshot);
    this.applySnapshot(previousSnapshot);
    this.currentSnapshot = previousSnapshot;
    this.updateAtoms();
    return true;
  }

  public redo(): boolean {
    this.flushScheduledSnapshot();
    if (!this.canRedo) return false;

    const nextSnapshot = this.redoStack.pop()!;
    this.undoStack.push(this.currentSnapshot);
    this.applySnapshot(nextSnapshot);
    this.currentSnapshot = nextSnapshot;
    this.updateAtoms();
    return true;
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

    this.undoStack.push(this.currentSnapshot);
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
      this.notationGraphStore.setAllNodes(this.cloneSnapshot(snapshot));
    } finally {
      this.isApplyingSnapshot = false;
    }
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
        node.decodedMask === null ? null : this.cloneImageData(node.decodedMask),
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

  private areDataItemsEqual(first: Node["data"], second: Node["data"]): boolean {
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
