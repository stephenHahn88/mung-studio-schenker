import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai";
import { Node } from "../../mung/Node";
import {
  collectTimeGroups,
  countMalformedTimeGroupItems,
  hasTimeGroupData,
  TIME_GROUP_PREFIX,
  timeGroupDataItem,
  timeGroupKey,
} from "../../mung/TimeGroups";
import { NotationGraphStore } from "./notation-graph-store/NotationGraphStore";
import { HistoryStore } from "./HistoryStore";
import { SelectionStore } from "./SelectionStore";
import { TimeGroupStore } from "./TimeGroupStore";

function node(id: number, className = "noteheadBlack"): Node {
  return {
    id,
    className,
    left: id * 30,
    top: id * 20,
    width: 16,
    height: 12,
    decodedMask: null,
    polygon: null,
    textTranscription: null,
    syntaxInlinks: id === 1 ? [0] : [],
    syntaxOutlinks: id === 0 ? [1] : [],
    precedenceInlinks: [],
    precedenceOutlinks: [],
    data: { review: { type: "str", value: "preserve <this> & metadata" } },
  };
}
function fixture() {
  const jotai = createStore();
  const graph = new NotationGraphStore(
    [node(0), node(1, "noteheadHalf"), node(2), node(3, "stem")],
    { document: "synthetic-only", dataset: "test" },
    jotai,
  );
  const selection = new SelectionStore(graph, jotai);
  const history = new HistoryStore(graph, jotai);
  const store = new TimeGroupStore(graph, selection, jotai);
  return { jotai, graph, selection, history, store };
}
const groups = (f: ReturnType<typeof fixture>) =>
  collectTimeGroups(f.graph.nodes);
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test("create filters a mixed selection, permits singleton and leaves graph fields intact", () => {
  const f = fixture();
  const before = structuredClone(f.graph.nodes);
  f.selection.changeSelection([1, 3]);
  const id = f.store.createFromSelection()!;
  assert.deepEqual(groups(f)[0].memberIds, [1]);
  assert.equal(groups(f)[0].kind, "shared-time");
  assert.deepEqual(f.selection.selectedNodeIds, []);
  assert.equal(f.jotai.get(f.store.activeGroupIdAtom), id);
  for (const current of f.graph.nodes) {
    const data = { ...current.data };
    delete data[timeGroupKey(id)];
    assert.deepEqual(
      { ...current, data },
      before.find((n) => n.id === current.id),
    );
  }
  assert.equal(f.store.createFromSelection(), null);
  f.history.undo();
  assert.deepEqual(f.graph.nodes, before);
  f.history.redo();
  assert.deepEqual(groups(f)[0].memberIds, [1]);
});

test("overlapping groups count each note once; group selection and member selection differ", async () => {
  const f = fixture();
  f.selection.changeSelection([0, 1]);
  const first = f.store.createFromSelection()!;
  f.selection.changeSelection([1, 2]);
  const second = f.store.createFromSelection({ allowOverlap: true })!;
  assert.equal(groups(f).length, 2);
  assert.equal(
    Object.keys(f.graph.getNode(1).data).filter((key) =>
      key.startsWith(TIME_GROUP_PREFIX),
    ).length,
    2,
  );
  await flush();
  assert.deepEqual(f.jotai.get(f.store.coverageAtom), {
    total: 3,
    grouped: 3,
    ungrouped: 0,
  });
  f.store.selectMembers(first);
  assert.deepEqual(f.selection.selectedNodeIds, [0, 1]);
  f.store.selectGroup(second);
  assert.deepEqual(f.selection.selectedNodeIds, []);
  f.store.deleteGroup(second);
  f.store.selectUngrouped();
  assert.deepEqual(f.selection.selectedNodeIds, [2]);
});

test("split into two singletons, then merge union, with one undo for each action", () => {
  const f = fixture();
  f.selection.changeSelection([0, 1]);
  const first = f.store.createFromSelection()!;
  f.selection.changeSelection([0]);
  const second = f.store.splitSelected(first)!;
  assert.deepEqual(
    groups(f)
      .map((g) => g.memberIds)
      .sort(),
    [[0], [1]],
  );
  f.history.undo();
  assert.deepEqual(groups(f)[0].memberIds, [0, 1]);
  f.history.redo();
  f.store.mergeGroups([first, second]);
  assert.equal(groups(f).length, 1);
  assert.deepEqual(groups(f)[0].memberIds, [0, 1]);
  f.history.undo();
  assert.equal(groups(f).length, 2);
  f.history.redo();
  assert.equal(groups(f).length, 1);
  f.store.selectMembers(first);
  assert.equal(
    f.store.splitSelected(first),
    null,
    "cannot split every member out",
  );
});

test("add/remove/delete touch only the requested group and preserve nodes and links", () => {
  const f = fixture();
  f.selection.changeSelection([0]);
  const first = f.store.createFromSelection()!;
  f.selection.changeSelection([0, 1]);
  const second = f.store.createFromSelection({ allowOverlap: true })!;
  f.selection.changeSelection([1, 2, 3]);
  f.store.addSelected(first, { allowOverlap: true });
  assert.deepEqual(groups(f).find((g) => g.id === first)!.memberIds, [0, 1, 2]);
  f.selection.changeSelection([0, 2]);
  f.store.removeSelected(first);
  assert.deepEqual(groups(f).find((g) => g.id === first)!.memberIds, [1]);
  f.store.deleteGroup(first);
  assert.deepEqual(groups(f)[0].memberIds, [0, 1]);
  assert.equal(groups(f)[0].id, second);
  assert.equal(f.graph.nodes.length, 4);
  assert.deepEqual(f.graph.getNode(0).syntaxOutlinks, [1]);
  assert.deepEqual(f.graph.getNode(1).syntaxInlinks, [0]);
});

test("rename is validated, XML-special text is retained, and a stale member cannot revert it", () => {
  const f = fixture();
  f.selection.changeSelection([0]);
  const id = f.store.createFromSelection()!;
  const old = f.graph.getNode(0).data[timeGroupKey(id)];
  assert.throws(() => f.store.renameGroup(id, "  "));
  assert.throws(() => f.store.renameGroup(id, "x".repeat(81)));
  f.store.renameGroup(id, "  Café é & <A> ‘B’  ");
  f.graph.applyRemoteOp({
    t: "patchTimeGroups",
    patches: [{ nodeId: 1, data: { [timeGroupKey(id)]: old } }],
  });
  assert.equal(groups(f)[0].label, "Café é & <A> ‘B’");
  assert.deepEqual(groups(f)[0].memberIds, [0, 1]);
});

test("node movement updates derived boxes; reclassification is visible and removable", async () => {
  const f = fixture();
  f.selection.changeSelection([0, 1]);
  const id = f.store.createFromSelection()!;
  f.graph.updateNode({
    ...f.graph.getNode(1),
    className: "stem",
    left: 100,
    top: 90,
  });
  await flush();
  const group = f.jotai.get(f.store.groupsAtom)[0];
  assert.equal(group.width, 116);
  assert.equal(group.height, 102);
  assert.deepEqual(group.nonNoteheadIds, [1]);
  f.selection.changeSelection([1]);
  f.store.removeSelected(id);
  assert.deepEqual(groups(f)[0].memberIds, [0]);
});

test("deleting the last member removes a group; a newly created node reusing its ID is ungrouped", async () => {
  const f = fixture();
  f.selection.changeSelection([2]);
  f.store.createFromSelection();
  f.graph.removeNodeWithLinks(2);
  await flush();
  assert.equal(groups(f).length, 0);
  assert.equal(f.jotai.get(f.store.activeGroupIdAtom), null);
  f.history.undo();
  assert.deepEqual(groups(f)[0].memberIds, [2]);
  f.graph.removeNodeWithLinks(2);
  f.graph.insertNode(node(2));
  assert.equal(groups(f).length, 0);
});

test("malformed/future records survive ordinary work and are flagged instead of silently erased", () => {
  const f = fixture();
  const malformed = { type: "str", value: "{invalid" };
  const future = timeGroupDataItem({
    version: 2,
    label: "future",
    kind: "shared-time",
    provenance: "manual",
    createdAt: "2026-09-10",
    updatedAt: "2026-09-10",
  } as any);
  f.graph.updateNode({
    ...f.graph.getNode(0),
    data: {
      ...f.graph.getNode(0).data,
      [TIME_GROUP_PREFIX + "broken"]: malformed,
      [TIME_GROUP_PREFIX + "future"]: future,
    },
  });
  assert.equal(groups(f).length, 0);
  assert.equal(countMalformedTimeGroupItems(f.graph.nodes), 2);
  assert.equal(hasTimeGroupData(f.graph.getNode(0)), true);
  f.selection.changeSelection([0]);
  const id = f.store.createFromSelection()!;
  f.store.deleteGroup(id);
  assert.equal(countMalformedTimeGroupItems(f.graph.nodes), 2);
  assert.deepEqual(
    f.graph.getNode(0).data[TIME_GROUP_PREFIX + "broken"],
    malformed,
  );
});

test("add/merge reject an entire action if it would replace an unsupported existing membership", () => {
  const f = fixture();
  f.selection.changeSelection([0]);
  const first = f.store.createFromSelection()!;
  f.selection.changeSelection([1]);
  const second = f.store.createFromSelection()!;
  f.graph.updateNode({
    ...f.graph.getNode(1),
    data: {
      ...f.graph.getNode(1).data,
      [timeGroupKey(first)]: {
        type: "str",
        value: "unsupported-future-record",
      },
    },
  });
  const before = structuredClone(f.graph.nodes);
  f.selection.changeSelection([1, 2]);
  assert.throws(() => f.store.addSelected(first), /left unchanged/);
  assert.deepEqual(f.graph.nodes, before);
  assert.throws(() => f.store.mergeGroups([first, second]), /left unchanged/);
  assert.deepEqual(f.graph.nodes, before);
  assert.equal(countMalformedTimeGroupItems(f.graph.nodes), 1);
});

for (const action of ["remove", "split"] as const) {
  test(`${action} retains the latest group label when a member carries stale metadata`, () => {
    const f = fixture();
    f.selection.changeSelection([0]);
    const id = f.store.createFromSelection()!;
    const old = f.graph.getNode(0).data[timeGroupKey(id)];
    f.store.renameGroup(id, "Retain this label");
    f.graph.applyRemoteOp({
      t: "patchTimeGroups",
      patches: [{ nodeId: 1, data: { [timeGroupKey(id)]: old } }],
    });
    f.selection.changeSelection([0]);
    if (action === "remove") f.store.removeSelected(id);
    else f.store.splitSelected(id);
    const remaining = groups(f).find((group) => group.id === id)!;
    assert.equal(remaining.label, "Retain this label");
    assert.deepEqual(remaining.memberIds, [1]);
    f.history.undo();
    assert.deepEqual(
      groups(f).find((group) => group.id === id)!.memberIds,
      [0, 1],
    );
  });
}

test("an exact repeated selection reopens its group without a graph operation or undo entry", () => {
  const f = fixture();
  f.selection.changeSelection([0, 1]);
  const id = f.store.createFromSelection()!;
  const before = structuredClone(f.graph.getMungFile());
  let changes = 0;
  const operations: unknown[] = [];
  f.graph.onChange.subscribe(() => changes++);
  f.graph.opSink = (operation) => operations.push(operation);
  f.store.finishEditing();
  f.jotai.set(f.store.showGroupsAtom, false);
  f.selection.changeSelection([1, 0, 3]);
  assert.equal(f.store.createFromSelection(), id);
  assert.equal(f.jotai.get(f.store.activeGroupIdAtom), id);
  assert.equal(f.jotai.get(f.store.showGroupsAtom), true);
  assert.deepEqual(f.selection.selectedNodeIds, []);
  assert.deepEqual(f.graph.getMungFile(), before);
  assert.equal(changes, 0);
  assert.deepEqual(operations, []);
  f.history.undo();
  assert.equal(groups(f).length, 0, "reuse did not add a no-op history entry");
  f.history.redo();
  assert.deepEqual(f.graph.getMungFile(), before);
});

test("exact reuse preserves pending redo and never creates a duplicate even with overlap opt-in", () => {
  const f = fixture();
  f.selection.changeSelection([0]);
  const id = f.store.createFromSelection()!;
  f.store.renameGroup(id, "Renamed");
  f.history.undo();
  assert.equal(f.history.canRedo, true);
  f.selection.changeSelection([0]);
  assert.equal(f.store.createFromSelection({ allowOverlap: true }), id);
  assert.equal(groups(f).length, 1);
  assert.equal(f.history.canRedo, true);
  f.history.redo();
  assert.equal(groups(f)[0].label, "Renamed");
});

test("multiple historical exact groups require explicit choice and remain untouched", () => {
  const f = fixture();
  f.selection.changeSelection([0]);
  const first = f.store.createFromSelection()!;
  const value = f.graph.getNode(0).data[timeGroupKey(first)];
  f.graph.applyRemoteOp({
    t: "patchTimeGroups",
    patches: [
      { nodeId: 0, data: { [timeGroupKey("historical-duplicate")]: value } },
    ],
  });
  f.store.finishEditing();
  f.selection.changeSelection([0]);
  const before = structuredClone(f.graph.getMungFile());
  assert.equal(f.store.classifySelection().exactMatches.length, 2);
  for (const options of [{}, { allowOverlap: true }]) {
    assert.throws(
      () => f.store.createFromSelection(options),
      /more than one existing group/,
    );
    assert.deepEqual(f.graph.getMungFile(), before);
    assert.deepEqual(f.selection.selectedNodeIds, [0]);
    assert.equal(f.jotai.get(f.store.activeGroupIdAtom), null);
  }
  f.store.selectGroup(first);
  assert.equal(f.jotai.get(f.store.activeGroupIdAtom), first);
  assert.deepEqual(f.graph.getMungFile(), before);
});

test("partial overlap is blocked atomically until explicitly requested", () => {
  const f = fixture();
  f.selection.changeSelection([0, 1]);
  const first = f.store.createFromSelection()!;
  f.selection.changeSelection([1, 2, 3]);
  const before = structuredClone(f.graph.getMungFile());
  let changes = 0;
  f.graph.onChange.subscribe(() => changes++);
  assert.throws(
    () => f.store.createFromSelection(),
    /explicitly create an overlapping group/,
  );
  assert.equal(changes, 0);
  assert.deepEqual(f.graph.getMungFile(), before);
  assert.deepEqual(f.selection.selectedNodeIds, [1, 2, 3]);
  const second = f.store.createFromSelection({ allowOverlap: true })!;
  assert.notEqual(first, second);
  assert.deepEqual(
    groups(f).find((group) => group.id === first)!.memberIds,
    [0, 1],
  );
  assert.deepEqual(
    groups(f).find((group) => group.id === second)!.memberIds,
    [1, 2],
  );
  f.history.undo();
  assert.deepEqual(f.graph.getMungFile(), before);
});

test("live analysis reports exact matches, overlap, new additions and other-group conflicts", async () => {
  const f = fixture();
  f.selection.changeSelection([0]);
  const first = f.store.createFromSelection()!;
  f.selection.changeSelection([1]);
  const second = f.store.createFromSelection()!;
  f.selection.changeSelection([0, 1, 2, 3]);
  const immediate = f.store.classifySelection();
  assert.deepEqual(immediate.selectedNoteheadIds, [0, 1, 2]);
  assert.deepEqual(immediate.exactMatches, []);
  assert.deepEqual(
    new Set(immediate.overlapGroups.map((group) => group.id)),
    new Set([first, second]),
  );
  assert.deepEqual(immediate.overlappingNoteheadIds, [0, 1]);
  assert.deepEqual(immediate.ungroupedNoteheadIds, [2]);
  const option = immediate.groupOptions.find(
    ({ group }) => group.id === first,
  )!;
  assert.deepEqual(option.selectedMemberIds, [0]);
  assert.deepEqual(option.newMemberIds, [1, 2]);
  assert.deepEqual(option.conflictingMemberIds, [1]);
  assert.deepEqual(
    option.conflictingGroups.map((group) => group.id),
    [second],
  );
  await flush();
  assert.deepEqual(f.jotai.get(f.store.selectionAnalysisAtom), immediate);
  f.graph.updateNode({ ...f.graph.getNode(2), className: "stem" });
  await flush();
  assert.deepEqual(
    f.jotai.get(f.store.selectionAnalysisAtom).selectedNoteheadIds,
    [0, 1],
  );
  f.selection.changeSelection([1]);
  assert.deepEqual(
    f.jotai
      .get(f.store.selectionAnalysisAtom)
      .exactMatches.map((group) => group.id),
    [second],
  );
  f.store.deleteGroup(second);
  await flush();
  assert.deepEqual(f.jotai.get(f.store.selectionAnalysisAtom).exactMatches, []);
  assert.deepEqual(
    f.jotai.get(f.store.selectionAnalysisAtom).ungroupedNoteheadIds,
    [1],
  );
});

test("adding a missing ungrouped note is one undoable edit and retains all existing data", () => {
  const f = fixture();
  f.selection.changeSelection([0]);
  const id = f.store.createFromSelection()!;
  const before = structuredClone(f.graph.getMungFile());
  f.selection.changeSelection([0, 1, 3]);
  f.store.addSelected(id);
  assert.deepEqual(groups(f)[0].memberIds, [0, 1]);
  assert.deepEqual(
    f.graph.getNode(0),
    before.nodes.find((node) => node.id === 0),
  );
  assert.deepEqual(
    f.graph.getNode(3),
    before.nodes.find((node) => node.id === 3),
  );
  assert.deepEqual(f.graph.getNode(1).syntaxInlinks, [0]);
  assert.deepEqual(
    f.graph.getNode(1).data.review,
    before.nodes.find((node) => node.id === 1)!.data.review,
  );
  f.history.undo();
  assert.deepEqual(f.graph.getMungFile(), before);
  f.history.redo();
  assert.deepEqual(groups(f)[0].memberIds, [0, 1]);
});

test("adding another group's note requires explicit confirmation and preserves its old membership", () => {
  const f = fixture();
  f.selection.changeSelection([0]);
  const first = f.store.createFromSelection()!;
  f.selection.changeSelection([1]);
  const second = f.store.createFromSelection()!;
  const before = structuredClone(f.graph.getMungFile());
  f.selection.changeSelection([1, 2]);
  assert.throws(
    () => f.store.addSelected(first),
    /Confirm keeping those memberships/,
  );
  assert.deepEqual(
    f.graph.getMungFile(),
    before,
    "even the ungrouped selected member was not added",
  );
  f.store.addSelected(first, { allowOverlap: true });
  assert.deepEqual(
    groups(f).find((group) => group.id === first)!.memberIds,
    [0, 1, 2],
  );
  assert.deepEqual(groups(f).find((group) => group.id === second)!.memberIds, [
    1,
  ]);
  f.history.undo();
  assert.deepEqual(f.graph.getMungFile(), before);
});

test("adding existing overlapping members is a no-op and needs no confirmation", () => {
  const f = fixture();
  f.selection.changeSelection([0, 1]);
  const first = f.store.createFromSelection()!;
  f.selection.changeSelection([1]);
  const second = f.store.createFromSelection({ allowOverlap: true })!;
  const before = structuredClone(f.graph.getMungFile());
  f.selection.changeSelection([1]);
  const addition = f.store
    .classifySelection()
    .groupOptions.find(({ group }) => group.id === first)!;
  assert.deepEqual(addition.newMemberIds, []);
  assert.deepEqual(addition.conflictingMemberIds, []);
  f.store.addSelected(first);
  assert.deepEqual(f.graph.getMungFile(), before);
  f.history.undo();
  assert.deepEqual(
    groups(f).map((group) => group.id),
    [first],
    `no-op did not hide undo of ${second}`,
  );
});

test("finish editing changes only active group and note selection, and leaves redo intact", () => {
  const f = fixture();
  assert.equal(f.jotai.get(f.store.showAllGroupLabelsAtom), false);
  f.selection.changeSelection([0]);
  const id = f.store.createFromSelection()!;
  f.store.renameGroup(id, "Redo name");
  f.history.undo();
  f.store.selectMembers(id);
  f.jotai.set(f.store.showAllGroupLabelsAtom, true);
  const before = structuredClone(f.graph.getMungFile());
  let changes = 0;
  f.graph.onChange.subscribe(() => changes++);
  f.store.finishEditing();
  assert.equal(f.jotai.get(f.store.activeGroupIdAtom), null);
  assert.deepEqual(f.selection.selectedNodeIds, []);
  assert.equal(f.jotai.get(f.store.showGroupsAtom), true);
  assert.equal(f.jotai.get(f.store.showAllGroupLabelsAtom), true);
  assert.deepEqual(f.graph.getMungFile(), before);
  assert.equal(changes, 0);
  f.history.redo();
  assert.equal(groups(f)[0].label, "Redo name");
});

test("merge with selected missing notes applies the complete union in one history transaction", () => {
  const f = fixture();
  f.selection.changeSelection([0]);
  const first = f.store.createFromSelection()!;
  f.selection.changeSelection([1]);
  const second = f.store.createFromSelection()!;
  const before = structuredClone(f.graph.getMungFile());
  f.selection.changeSelection([0, 1, 2, 3]);
  assert.equal(
    f.store.mergeGroups([first, second], { includeSelected: true }),
    first,
  );
  assert.deepEqual(
    groups(f).map((group) => group.memberIds),
    [[0, 1, 2]],
  );
  assert.deepEqual(
    f.graph.getNode(3),
    before.nodes.find((node) => node.id === 3),
  );
  for (const current of f.graph.nodes) {
    assert.deepEqual(
      current.data.review,
      before.nodes.find((node) => node.id === current.id)!.data.review,
    );
  }
  assert.deepEqual(f.selection.selectedNodeIds, []);
  f.history.undo();
  assert.deepEqual(f.graph.getMungFile(), before);
  f.history.redo();
  assert.deepEqual(
    groups(f).map((group) => group.memberIds),
    [[0, 1, 2]],
  );
});

test("merge does not silently absorb selections from an outside group", () => {
  const f = fixture();
  const ids = [0, 1, 2].map((nodeId) => {
    f.selection.changeSelection([nodeId]);
    return f.store.createFromSelection()!;
  });
  f.selection.changeSelection([2]);
  const before = structuredClone(f.graph.getMungFile());
  assert.throws(
    () => f.store.mergeGroups(ids.slice(0, 2), { includeSelected: true }),
    /outside this merge/,
  );
  assert.deepEqual(f.graph.getMungFile(), before);
  f.store.mergeGroups(ids.slice(0, 2), {
    includeSelected: true,
    allowOverlap: true,
  });
  assert.deepEqual(
    groups(f).find((group) => group.id === ids[0])!.memberIds,
    [0, 1, 2],
  );
  assert.deepEqual(groups(f).find((group) => group.id === ids[2])!.memberIds, [
    2,
  ]);
  f.history.undo();
  assert.deepEqual(f.graph.getMungFile(), before);
});

test("global removal works with no active group and counts only selected valid members", async () => {
  const f = fixture();
  f.selection.changeSelection([0, 1]);
  const id = f.store.createFromSelection()!;
  f.store.finishEditing();
  f.selection.changeSelection([0, 2, 3]);
  await flush();
  assert.equal(f.jotai.get(f.store.activeGroupIdAtom), null);
  assert.deepEqual(
    f.jotai.get(f.store.selectedGroupedMembersAtom).map((member) => member.id),
    [0],
  );
  const before = structuredClone(f.graph.getMungFile());
  assert.equal(f.store.removeSelectedFromAllGroups(), 1);
  assert.deepEqual(
    groups(f).map((group) => group.memberIds),
    [[1]],
  );
  assert.deepEqual(f.selection.selectedNodeIds, [0, 2, 3]);
  const expected = structuredClone(before);
  delete expected.nodes[0].data[timeGroupKey(id)];
  assert.deepEqual(f.graph.getMungFile(), expected);
  await flush();
  assert.deepEqual(f.jotai.get(f.store.selectedGroupedMembersAtom), []);
  assert.deepEqual(f.jotai.get(f.store.coverageAtom), {
    total: 3,
    grouped: 1,
    ungrouped: 2,
  });
});

test("global cross-group removal ignores a different active group and is one complete undo/redo", (t) => {
  // ImageData stub for Node
  const previousImageData = Object.getOwnPropertyDescriptor(
    globalThis,
    "ImageData",
  );
  Object.defineProperty(globalThis, "ImageData", {
    configurable: true,
    value: function (data: Uint8ClampedArray, width: number, height: number) {
      return { data, width, height, colorSpace: "srgb" };
    },
  });
  t.after(() => {
    if (previousImageData)
      Object.defineProperty(globalThis, "ImageData", previousImageData);
    else Reflect.deleteProperty(globalThis, "ImageData");
  });
  const f = fixture();
  f.graph.updateNode({
    ...f.graph.getNode(0),
    decodedMask: {
      width: 16,
      height: 12,
      colorSpace: "srgb",
      data: new Uint8ClampedArray(16 * 12 * 4).fill(173),
    } as ImageData,
    polygon: [0, 0, 16, 0, 16, 12],
    textTranscription: "preserved transcription",
  });
  f.selection.changeSelection([0, 1]);
  const first = f.store.createFromSelection()!;
  f.selection.changeSelection([1, 2]);
  const second = f.store.createFromSelection({ allowOverlap: true })!;
  f.selection.changeSelection([2]);
  const active = f.store.createFromSelection({ allowOverlap: true })!;
  f.selection.changeSelection([0, 1]);
  const before = structuredClone(f.graph.getMungFile());
  const expected = structuredClone(before);
  delete expected.nodes[0].data[timeGroupKey(first)];
  delete expected.nodes[1].data[timeGroupKey(first)];
  delete expected.nodes[1].data[timeGroupKey(second)];
  let notifications = 0;
  const operations: any[] = [];
  f.graph.onChange.subscribe(() => notifications++);
  f.graph.opSink = (operation) => operations.push(operation);
  assert.equal(f.store.removeSelectedFromAllGroups(), 2);
  assert.equal(notifications, 1);
  assert.equal(operations.length, 1);
  assert.equal(operations[0].t, "patchTimeGroups");
  assert.deepEqual(f.graph.getMungFile(), expected);
  assert.equal(f.jotai.get(f.store.activeGroupIdAtom), active);
  assert.deepEqual(f.selection.selectedNodeIds, [0, 1]);
  assert.deepEqual(groups(f).find((group) => group.id === second)!.memberIds, [
    2,
  ]);
  assert.deepEqual(groups(f).find((group) => group.id === active)!.memberIds, [
    2,
  ]);
  assert.equal(f.history.undo(), true);
  assert.deepEqual(f.graph.getMungFile(), before);
  assert.equal(f.history.redo(), true);
  assert.deepEqual(f.graph.getMungFile(), expected);
});

test("global removal includes explicitly selected reclassified members and removes the last derived group", async () => {
  const f = fixture();
  f.selection.changeSelection([1]);
  const id = f.store.createFromSelection()!;
  f.graph.updateNode({ ...f.graph.getNode(1), className: "stem" });
  f.selection.changeSelection([1]);
  await flush();
  assert.deepEqual(f.jotai.get(f.store.selectedNoteheadsAtom), []);
  assert.deepEqual(
    f.jotai.get(f.store.selectedGroupedMembersAtom).map((member) => member.id),
    [1],
  );
  const before = structuredClone(f.graph.getMungFile());
  assert.equal(f.store.removeSelectedFromAllGroups(), 1);
  await flush();
  assert.deepEqual(groups(f), []);
  assert.equal(f.jotai.get(f.store.activeGroupIdAtom), null);
  assert.equal(f.graph.getNode(1).className, "stem");
  assert.deepEqual(f.selection.selectedNodeIds, [1]);
  assert.equal(f.graph.nodes.length, 4);
  f.history.undo();
  assert.deepEqual(f.graph.getMungFile(), before);
  assert.equal(groups(f)[0].id, id);
});

test("global removal preserves malformed, future and invalid-key records including matching group keys on other nodes", () => {
  const f = fixture();
  f.selection.changeSelection([0, 1]);
  const id = f.store.createFromSelection()!;
  const key = timeGroupKey(id);
  const valid = f.graph.getNode(0).data[key];
  const future = {
    ...valid,
    value: valid.value.replace('"version":1', '"version":2'),
  };
  f.graph.applyRemoteOp({
    t: "patchTimeGroups",
    patches: [
      {
        nodeId: 0,
        data: {
          [timeGroupKey("broken")]: { type: "str", value: "{broken" },
          [timeGroupKey("future")]: future,
        },
      },
      { nodeId: 2, data: { [key]: future } },
    ],
  });
  f.graph.updateNode({
    ...f.graph.getNode(0),
    data: {
      ...f.graph.getNode(0).data,
      [TIME_GROUP_PREFIX + "invalid key"]: valid,
    },
  });
  f.selection.changeSelection([0, 2]);
  const before = structuredClone(f.graph.getMungFile());
  const expected = structuredClone(before);
  delete expected.nodes[0].data[key];
  assert.equal(f.store.removeSelectedFromAllGroups(), 1);
  assert.deepEqual(f.graph.getMungFile(), expected);
  assert.equal(countMalformedTimeGroupItems(f.graph.nodes), 4);
  assert.deepEqual(groups(f)[0].memberIds, [1]);
  f.history.undo();
  assert.deepEqual(f.graph.getMungFile(), before);
});

test("global removal without valid selected memberships does not dirty, broadcast or discard redo", async () => {
  const f = fixture();
  f.selection.changeSelection([0]);
  const id = f.store.createFromSelection()!;
  f.store.renameGroup(id, "Redo this label");
  f.history.undo();
  const before = structuredClone(f.graph.getMungFile());
  let notifications = 0;
  const operations: unknown[] = [];
  f.graph.onChange.subscribe(() => notifications++);
  f.graph.opSink = (operation) => operations.push(operation);
  for (const selected of [[], [1], [2, 3]]) {
    f.selection.changeSelection(selected);
    await flush();
    assert.deepEqual(f.jotai.get(f.store.selectedGroupedMembersAtom), []);
    assert.equal(f.store.removeSelectedFromAllGroups(), 0);
  }
  assert.equal(notifications, 0);
  assert.deepEqual(operations, []);
  assert.deepEqual(f.graph.getMungFile(), before);
  assert.equal(f.history.canRedo, true);
  f.history.redo();
  assert.equal(groups(f)[0].label, "Redo this label");
});

test("global removal carries latest labels to survivors across affected groups and restores exact stale metadata on undo", () => {
  const f = fixture();
  f.selection.changeSelection([0]);
  const first = f.store.createFromSelection()!;
  const firstOld = f.graph.getNode(0).data[timeGroupKey(first)];
  f.store.renameGroup(first, "Latest first label");
  f.graph.applyRemoteOp({
    t: "patchTimeGroups",
    patches: [{ nodeId: 1, data: { [timeGroupKey(first)]: firstOld } }],
  });
  f.selection.changeSelection([0, 2]);
  const second = f.store.createFromSelection({ allowOverlap: true })!;
  const secondOld = f.graph.getNode(0).data[timeGroupKey(second)];
  f.store.renameGroup(second, "Latest second label");
  f.graph.applyRemoteOp({
    t: "patchTimeGroups",
    patches: [{ nodeId: 1, data: { [timeGroupKey(second)]: secondOld } }],
  });
  f.selection.changeSelection([0, 2]);
  const before = structuredClone(f.graph.getMungFile());
  assert.equal(f.store.removeSelectedFromAllGroups(), 2);
  assert.deepEqual(
    groups(f).map((group) => group.memberIds),
    [[1], [1]],
  );
  assert.equal(
    groups(f).find((group) => group.id === first)!.label,
    "Latest first label",
  );
  assert.equal(
    groups(f).find((group) => group.id === second)!.label,
    "Latest second label",
  );
  const after = structuredClone(f.graph.getMungFile());
  f.history.undo();
  assert.deepEqual(f.graph.getMungFile(), before);
  f.history.redo();
  assert.deepEqual(f.graph.getMungFile(), after);
});

test("global removal uses live memberships before notification and undo preserves a peer's subsequent edit", () => {
  const f = fixture();
  f.selection.changeSelection([0, 1]);
  const id = f.store.createFromSelection()!;
  const key = timeGroupKey(id);
  const original = f.graph.getNode(0).data[key];
  f.selection.changeSelection([0]);
  f.graph.applyRemoteOp({
    t: "patchTimeGroups",
    patches: [
      { nodeId: 0, data: { [timeGroupKey("peer-overlap")]: original } },
    ],
  });
  assert.equal(f.store.removeSelectedFromAllGroups(), 1);
  assert.deepEqual(f.graph.getNode(0).data, {
    review: { type: "str", value: "preserve <this> & metadata" },
  });
  const peer = {
    ...original,
    value: original.value.replace('"Group 1"', '"Peer update"'),
  };
  f.graph.applyRemoteOp({
    t: "patchTimeGroups",
    patches: [{ nodeId: 0, data: { [key]: peer } }],
  });
  f.history.undo();
  assert.deepEqual(f.graph.getNode(0).data[key], peer);
  assert.deepEqual(
    f.graph.getNode(0).data[timeGroupKey("peer-overlap")],
    original,
  );
  f.history.redo();
  assert.deepEqual(f.graph.getNode(0).data[key], peer);
  assert.equal(
    f.graph.getNode(0).data[timeGroupKey("peer-overlap")],
    undefined,
  );
});

test("predicted groups keep manual groups unchanged, skip non-noteheads and undo in one step", () => {
  const f = fixture();
  f.selection.changeSelection([0]);
  const manual = f.store.createFromSelection()!;
  const summary = f.store.addPredictedGroups([[0, 1], [2, 3], [3], [99]]);
  assert.deepEqual(summary, { createdGroups: 2, skippedNoteheads: 1 });
  const all = groups(f);
  assert.equal(all.length, 3);
  const manualGroup = all.find((group) => group.id === manual)!;
  assert.equal(manualGroup.provenance, "manual");
  assert.deepEqual(manualGroup.memberIds, [0]);
  const predicted = all.filter((group) => group.provenance === "predicted");
  // Groups created in the same millisecond have no defined order.
  assert.deepEqual(predicted.map((group) => [...group.memberIds]).sort(), [
    [1],
    [2],
  ]);
  assert.equal(new Set(all.map((group) => group.label)).size, 3);
  f.history.undo();
  assert.deepEqual(
    groups(f).map((group) => group.id),
    [manual],
  );
});
