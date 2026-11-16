import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai";
import { Node } from "../../mung/Node";
import {
  checkTimeGroupCoverage,
  timeGroupKey,
  TIME_GROUP_PREFIX,
} from "../../mung/TimeGroups";
import { NotationGraphStore } from "./notation-graph-store/NotationGraphStore";
import { SelectionStore } from "./SelectionStore";
import { TimeGroupStore } from "./TimeGroupStore";
import { HistoryStore } from "./HistoryStore";
import { ClassVisibilityStore } from "./ClassVisibilityStore";

function node(id: number, className = "noteheadBlack"): Node {
  return {
    id,
    className,
    top: id * 20,
    left: id * 25,
    width: 15,
    height: 10,
    syntaxInlinks: [],
    syntaxOutlinks: [],
    precedenceInlinks: [],
    precedenceOutlinks: [],
    decodedMask: null,
    polygon: null,
    textTranscription: null,
    data: { unrelated: { type: "str", value: "preserve" } },
  };
}
function fixture(
  nodes = [
    node(0),
    node(1, "noteheadHalf"),
    node(2, "noteheadFullSmall"),
    node(3, "stem"),
  ],
) {
  const jotai = createStore();
  const graph = new NotationGraphStore(
    nodes,
    { dataset: "synthetic", document: "coverage-test" },
    jotai,
  );
  const selection = new SelectionStore(graph, jotai);
  const store = new TimeGroupStore(graph, selection, jotai);
  const history = new HistoryStore(graph, jotai);
  const group = (ids: number[], allowOverlap = false) => {
    selection.changeSelection(ids);
    return store.createFromSelection({ allowOverlap })!;
  };
  return { jotai, graph, selection, store, history, group };
}
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test("empty documents and documents containing only non-noteheads never pass coverage", () => {
  for (const nodes of [[], [node(0, "stem")]]) {
    const report = checkTimeGroupCoverage(nodes);
    assert.equal(report.totalNoteheads, 0);
    assert.equal(report.allNoteheadsGrouped, false);
    assert.deepEqual(report.ungroupedNodeIds, []);
  }
});

test("coverage includes hidden and small noteheads, without changing graph or history", async () => {
  const f = fixture();
  const visibility = new ClassVisibilityStore(f.graph, f.jotai);
  visibility.hideAllClasses();
  f.group([0]);
  await flush();
  const before = structuredClone(f.graph.getMungFile());
  let changes = 0;
  f.graph.onChange.subscribe(() => changes++);
  const report = f.jotai.get(f.store.coverageReportAtom);
  assert.equal(report.totalNoteheads, 3);
  assert.equal(report.groupedNoteheads, 1);
  assert.deepEqual(report.ungroupedNodeIds, [1, 2]);
  assert.equal(report.allNoteheadsGrouped, false);
  assert.deepEqual(f.graph.getMungFile(), before);
  assert.equal(changes, 0);
  f.history.undo();
  assert.equal(
    checkTimeGroupCoverage(f.graph.nodes).groupedNoteheads,
    0,
    "coverage checks did not add undo entries",
  );
});

test("all covered includes singleton groups; overlapping memberships are separately reported", () => {
  const f = fixture();
  f.group([0, 1]);
  f.group([1], true);
  f.group([2]);
  const report = checkTimeGroupCoverage(f.graph.nodes);
  assert.equal(report.allNoteheadsGrouped, true);
  assert.equal(report.groupedNoteheads, 3, "count each notehead only once");
  assert.deepEqual(report.overlappingNodeIds, [1]);
  assert.deepEqual(report.ungroupedNodeIds, []);
  assert.equal(
    f.graph.nodes.length,
    4,
    "no artificial hypernode music symbols",
  );
});

test("coverage updates after deletion, undo and a newly inserted notehead", async () => {
  const f = fixture();
  const id = f.group([0, 1, 2]);
  await flush();
  assert.equal(
    f.jotai.get(f.store.coverageReportAtom).allNoteheadsGrouped,
    true,
  );
  f.store.deleteGroup(id);
  await flush();
  assert.deepEqual(
    f.jotai.get(f.store.coverageReportAtom).ungroupedNodeIds,
    [0, 1, 2],
  );
  f.history.undo();
  await flush();
  assert.equal(
    f.jotai.get(f.store.coverageReportAtom).allNoteheadsGrouped,
    true,
  );
  f.graph.insertNode(node(4));
  await flush();
  assert.deepEqual(f.jotai.get(f.store.coverageReportAtom).ungroupedNodeIds, [
    4,
  ]);
});

test("remote membership removal invalidates previously complete coverage", async () => {
  const f = fixture();
  const id = f.group([0, 1, 2]);
  await flush();
  assert.equal(
    f.jotai.get(f.store.coverageReportAtom).allNoteheadsGrouped,
    true,
  );
  f.graph.applyRemoteOp({
    t: "patchTimeGroups",
    patches: [{ nodeId: 1, data: { [timeGroupKey(id)]: null } }],
  });
  await flush();
  assert.deepEqual(f.jotai.get(f.store.coverageReportAtom).ungroupedNodeIds, [
    1,
  ]);
});

test("malformed group records do not count as coverage; reclassified members are visible review issues", () => {
  const f = fixture();
  const id = f.group([0, 1]);
  f.graph.updateNode({ ...f.graph.getNode(0), className: "stem" });
  const malformed = { type: "str", value: "invalid-json" };
  f.graph.updateNode({
    ...f.graph.getNode(2),
    data: {
      ...f.graph.getNode(2).data,
      [TIME_GROUP_PREFIX + "invalid"]: malformed,
    },
  });
  const report = checkTimeGroupCoverage(f.graph.nodes);
  assert.equal(report.totalNoteheads, 2);
  assert.deepEqual(report.nonNoteheadMemberIds, [0]);
  assert.deepEqual(report.ungroupedNodeIds, [2]);
  assert.equal(report.malformedRecords, 1);
  assert.deepEqual(
    f.graph.getNode(2).data[TIME_GROUP_PREFIX + "invalid"],
    malformed,
  );
  assert.ok(f.graph.getNode(0).data[timeGroupKey(id)]);
});

test("Next ungrouped navigates spatially, wraps, skips newly grouped nodes, and only changes selection", () => {
  const f = fixture();
  f.graph.updateNode({ ...f.graph.getNode(2), top: -20 });
  const before = structuredClone(f.graph.getMungFile());
  assert.equal(f.store.selectNextUngrouped(), 2);
  assert.deepEqual(f.selection.selectedNodeIds, [2]);
  assert.equal(f.store.selectNextUngrouped(), 0);
  assert.equal(f.store.selectNextUngrouped(), 1);
  assert.equal(f.store.selectNextUngrouped(), 2);
  assert.deepEqual(f.graph.getMungFile(), before);
  f.store.createFromSelection();
  assert.equal(f.store.selectNextUngrouped(), 0);
  f.group([0, 1]);
  assert.equal(f.store.selectNextUngrouped(), null);
});
