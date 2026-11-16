import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai";
import { Node } from "../../mung/Node";
import { TIME_GROUP_PREFIX, TimeGroupPatch } from "../../mung/TimeGroups";
import { NotationGraphStore } from "./notation-graph-store/NotationGraphStore";
import { HistoryStore } from "./HistoryStore";
import { AutosaveStore } from "./AutosaveStore";
import { SelectionStore } from "./SelectionStore";
import { CollabController } from "../controller/CollabController";

const A = TIME_GROUP_PREFIX + "a";
const B = TIME_GROUP_PREFIX + "b";
const item = (value = "a") => ({ type: "str", value });
const patches = (
  key = A,
  ids = [0, 1],
  value: string | null = "a",
): TimeGroupPatch[] =>
  ids.map((nodeId) => ({
    nodeId,
    data: { [key]: value === null ? null : item(value) },
  }));
function node(id: number): Node {
  return {
    id,
    className: "noteheadBlack",
    left: 10 + id * 30,
    top: 20,
    width: 15,
    height: 10,
    decodedMask: null,
    polygon: null,
    textTranscription: null,
    syntaxInlinks: id === 1 ? [0] : [],
    syntaxOutlinks: id === 0 ? [1] : [],
    precedenceInlinks: [],
    precedenceOutlinks: [],
    data: {
      symbol_detector_source: item("visible"),
      unrelated: item("preserve me"),
    },
  };
}
function fixture() {
  const store = createStore();
  const graph = new NotationGraphStore(
    [node(0), node(1), node(2)],
    { dataset: "synthetic", document: "local-test-only" },
    store,
  );
  const history = new HistoryStore(graph, store);
  return { graph, history, store };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

test("group batch is one complete graph notification/op and preserves every non-group field", () => {
  const { graph } = fixture();
  const before = structuredClone(graph.nodes);
  const ops: any[] = [];
  graph.opSink = (op) => ops.push(op);
  let notifications = 0;
  graph.onChange.subscribe(() => {
    notifications++;
    assert.equal(graph.getNode(0).data[A].value, "a");
    assert.equal(graph.getNode(1).data[A].value, "a");
  });
  graph.applyTimeGroupPatches(patches());
  assert.equal(notifications, 1);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].t, "patchTimeGroups");
  assert.equal(ops[0].patches.length, 2);
  for (const current of graph.nodes) {
    const data = { ...current.data };
    delete data[A];
    assert.deepEqual(
      { ...current, data },
      before.find((old) => old.id === current.id),
    );
  }
  graph.applyTimeGroupPatches(patches());
  assert.equal(notifications, 1, "no-op does not dirty or broadcast");
});

test("invalid namespace, data, or missing local node rejects the whole batch before mutation", () => {
  const { graph } = fixture();
  const before = structuredClone(graph.nodes);
  for (const bad of [
    { nodeId: 1, data: { unrelated: null } },
    { nodeId: 1, data: { [A]: { type: "str", value: 3 } } },
    { nodeId: 100, data: { [A]: item() } },
  ]) {
    assert.throws(() =>
      graph.applyTimeGroupPatches([...patches(A, [0]), bad] as any),
    );
    assert.deepEqual(graph.nodes, before);
  }
});

test("one group action has one undo and redo, including a batch with overlapping memberships", () => {
  const { graph, history } = fixture();
  graph.applyTimeGroupPatches([...patches(), ...patches(B, [1, 2], "b")]);
  assert.equal(history.canUndo, true);
  assert.equal(history.undo(), true);
  assert.equal(history.canUndo, false);
  assert.equal(graph.getNode(0).data[A], undefined);
  assert.equal(graph.getNode(1).data[B], undefined);
  assert.equal(history.redo(), true);
  assert.equal(graph.getNode(1).data[A].value, "a");
  assert.equal(graph.getNode(1).data[B].value, "b");
});

test("two explicit group actions in one tick remain two undo items", () => {
  const { graph, history } = fixture();
  graph.applyTimeGroupPatches(patches());
  graph.applyTimeGroupPatches(patches(B, [1], "b"));
  history.undo();
  assert.equal(graph.getNode(1).data[B], undefined);
  assert.equal(graph.getNode(1).data[A].value, "a");
  history.undo();
  assert.equal(graph.getNode(1).data[A], undefined);
});

test("remote group batch has no echo and never becomes local undo", async () => {
  const { graph, history } = fixture();
  let sent = 0;
  graph.opSink = () => sent++;
  graph.applyRemoteOp({ t: "patchTimeGroups", patches: patches() });
  await flush();
  assert.equal(sent, 0);
  assert.equal(history.canUndo, false);
  assert.equal(graph.getNode(1).data[A].value, "a");
});

test("two clients concurrently create disjoint groups on shared members and undo only their own group", () => {
  const a = fixture();
  const b = fixture();
  const sentA: any[] = [];
  const sentB: any[] = [];
  a.graph.opSink = (op) => sentA.push(structuredClone(op));
  b.graph.opSink = (op) => sentB.push(structuredClone(op));
  a.graph.applyTimeGroupPatches(patches(A, [0, 1], "a"));
  b.graph.applyTimeGroupPatches(patches(B, [1, 2], "b"));
  a.graph.applyRemoteOp(sentB.shift());
  b.graph.applyRemoteOp(sentA.shift());
  assert.deepEqual(a.graph.nodes, b.graph.nodes);
  a.history.undo();
  assert.equal(sentA[0].t, "patchTimeGroups");
  b.graph.applyRemoteOp(sentA.shift());
  assert.deepEqual(a.graph.nodes, b.graph.nodes);
  assert.equal(a.graph.getNode(1).data[A], undefined);
  assert.equal(a.graph.getNode(1).data[B].value, "b");
  b.history.undo();
  a.graph.applyRemoteOp(sentB.shift());
  assert.deepEqual(a.graph.nodes, b.graph.nodes);
  assert.equal(a.graph.getNode(1).data[B], undefined);
});

test("conditional undo skips remotely overwritten fields and redo only restores the applied subset", () => {
  const { graph, history } = fixture();
  graph.applyTimeGroupPatches(patches());
  graph.applyRemoteOp({
    t: "patchTimeGroups",
    patches: patches(A, [1], "peer-label"),
  });
  history.undo();
  assert.equal(graph.getNode(0).data[A], undefined);
  assert.equal(graph.getNode(1).data[A].value, "peer-label");
  history.redo();
  assert.equal(graph.getNode(0).data[A].value, "a");
  assert.equal(graph.getNode(1).data[A].value, "peer-label");
});

test("remote changes after local undo are not overwritten by redo", () => {
  const { graph, history } = fixture();
  graph.applyTimeGroupPatches(patches(A, [0]));
  history.undo();
  graph.applyRemoteOp({
    t: "patchTimeGroups",
    patches: patches(A, [0], "peer"),
  });
  history.redo();
  assert.equal(graph.getNode(0).data[A].value, "peer");
  assert.equal(history.canUndo, false);
});

test("ordinary local undo preserves a remote group and a pending local edit is separate from remote group history", () => {
  const { graph, history } = fixture();
  graph.updateNode({ ...graph.getNode(0), left: 55 });
  graph.applyRemoteOp({ t: "patchTimeGroups", patches: patches(A, [0]) });
  history.undo();
  assert.equal(graph.getNode(0).left, 10);
  assert.equal(graph.getNode(0).data[A].value, "a");
  assert.equal(history.canUndo, false);
  history.redo();
  assert.equal(graph.getNode(0).left, 55);
  assert.equal(graph.getNode(0).data[A].value, "a");
});

test("stale ordinary remote node updates and snapshots cannot erase or resurrect separately patched groups", () => {
  const { graph } = fixture();
  const stale = structuredClone(graph.nodes);
  graph.applyTimeGroupPatches(patches());
  graph.applyRemoteOp({ t: "updateNode", node: { ...stale[0], left: 42 } });
  assert.equal(graph.getNode(0).data[A].value, "a");
  assert.equal(graph.getNode(0).left, 42);
  graph.applyRemoteOp({ t: "setAll", nodes: stale });
  assert.equal(graph.getNode(1).data[A].value, "a");
  const groupedStale = structuredClone(graph.getNode(0));
  graph.applyTimeGroupPatches(patches(A, [0], null));
  graph.applyRemoteOp({ t: "updateNode", node: groupedStale });
  assert.equal(graph.getNode(0).data[A], undefined);
});

test("deleted members remain absent on late remote patch; local ID reuse does not inherit membership", () => {
  const { graph, history } = fixture();
  graph.applyTimeGroupPatches(patches(A, [2]));
  graph.removeNodeWithLinks(2);
  graph.applyRemoteOp({ t: "patchTimeGroups", patches: patches(A, [2]) });
  assert.equal(graph.hasNode(2), false);
  history.undo();
  assert.equal(
    graph.getNode(2).data[A].value,
    "a",
    "manual deletion is undoable",
  );
  graph.removeNodeWithLinks(2);
  graph.insertNode(node(2));
  assert.equal(graph.getNode(2).data[A], undefined);
});

test("in-flight autosave never clears or loses a newer group revision", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { graph, store } = fixture();
  const autosave = new AutosaveStore(graph, store);
  const pending = deferred();
  let calls = 0;
  autosave.saveCallback = () => {
    calls++;
    return calls === 1 ? pending.promise : Promise.resolve();
  };
  graph.applyTimeGroupPatches(patches());
  t.mock.timers.tick(5000);
  assert.equal(calls, 1);
  const savedRevision = autosave.revision;
  graph.applyTimeGroupPatches(patches(B, [1], "b"));
  assert.ok(autosave.revision > savedRevision);
  t.mock.timers.tick(5000);
  assert.equal(
    calls,
    1,
    "no concurrent autosave while previous request is pending",
  );
  pending.resolve();
  await flush();
  assert.equal(autosave.isDirty, true);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(calls, 2);
  assert.equal(autosave.isDirty, false);
});

test("manual savedRevision keeps a newer edit dirty, then matching save cleans it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { graph, store } = fixture();
  const autosave = new AutosaveStore(graph, store);
  graph.applyTimeGroupPatches(patches());
  const saved = autosave.revision;
  graph.applyTimeGroupPatches(patches(B, [0], "b"));
  autosave.setClean(saved);
  assert.equal(autosave.isDirty, true);
  autosave.setClean(autosave.revision);
  assert.equal(autosave.isDirty, false);
});

test("missing autosave callback does not falsely mark a group saved", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { graph, store } = fixture();
  const autosave = new AutosaveStore(graph, store);
  graph.applyTimeGroupPatches(patches());
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(autosave.isDirty, true);
});

test("collaboration queues drag/group/drag in order and never coalesces away the atomic group batch", async (t) => {
  const { graph, store } = fixture();
  const collab = new CollabController(
    store,
    graph,
    new SelectionStore(graph, store),
    {
      backendUrl: "http://synthetic.invalid/",
      token: "synthetic-test-only",
      documentName: "local",
      userName: "test",
    },
  );
  const first = deferred();
  const observed: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    observed.push(JSON.parse(init.body).op);
    if (observed.length === 1) await first.promise;
    return { ok: true, status: 200 } as Response;
  });
  (collab as any).onLocalOp({
    t: "updateNode",
    node: { ...graph.getNode(0), left: 31 },
  });
  (collab as any).onLocalOp({ t: "patchTimeGroups", patches: patches() });
  (collab as any).onLocalOp({
    t: "updateNode",
    node: { ...graph.getNode(0), left: 44 },
  });
  (collab as any).flushUpdates();
  await flush();
  assert.equal(observed.length, 1);
  first.resolve();
  await (collab as any).postQueue;
  assert.deepEqual(
    observed.map((op) => op.t),
    ["updateNode", "patchTimeGroups", "updateNode"],
  );
  assert.equal(observed[0].node.left, 31);
  assert.equal(observed[2].node.left, 44);
  assert.equal(observed[1].patches.length, 2);
  collab.stop();
});

function collaborationFixture() {
  const fixtureValue = fixture();
  const { graph, store } = fixtureValue;
  const collab = new CollabController(
    store,
    graph,
    new SelectionStore(graph, store),
    {
      backendUrl: "http://synthetic.invalid/",
      token: "synthetic-test-only",
      documentName: "local",
      userName: "test",
    },
  );
  const receive = (event: any) => (collab as any).handleEvent(event);
  receive({ type: "init", seq: 0, oplog: [], users: [] });
  return { ...fixtureValue, collab, receive };
}

test("server-ordered own group acknowledgements make concurrent same-field renames converge", () => {
  const a = collaborationFixture();
  const b = collaborationFixture();
  const initial = { t: "patchTimeGroups", patches: patches(A, [0], "initial") };
  a.graph.applyRemoteOp(initial);
  b.graph.applyRemoteOp(initial);
  const opA = { t: "patchTimeGroups", patches: patches(A, [0], "rename-a") };
  const opB = { t: "patchTimeGroups", patches: patches(A, [0], "rename-b") };
  a.graph.applyTimeGroupPatches(opA.patches);
  b.graph.applyTimeGroupPatches(opB.patches);
  let echoes = 0;
  a.graph.opSink = () => echoes++;
  b.graph.opSink = () => echoes++;
  for (const client of [a, b]) {
    client.receive({
      type: "op",
      seq: 1,
      clientId: a.collab.selfClientId,
      op: opA,
    });
    client.receive({
      type: "op",
      seq: 2,
      clientId: b.collab.selfClientId,
      op: opB,
    });
  }
  assert.deepEqual(a.graph.nodes, b.graph.nodes);
  assert.equal(a.graph.getNode(0).data[A].value, "rename-b");
  assert.equal(echoes, 0);
  assert.equal((a.history as any).undoStack.length, 1);
  assert.equal((b.history as any).undoStack.length, 1);
  a.history.undo();
  assert.equal(
    a.graph.getNode(0).data[A].value,
    "rename-b",
    "losing local rename cannot undo the winner",
  );
});

test("concurrent rename/delete converges even when live broadcasts arrive out of sequence", () => {
  const a = collaborationFixture();
  const b = collaborationFixture();
  const initial = { t: "patchTimeGroups", patches: patches(A, [0], "initial") };
  a.graph.applyRemoteOp(initial);
  b.graph.applyRemoteOp(initial);
  const opA = { t: "patchTimeGroups", patches: patches(A, [0], "renamed") };
  const opB = { t: "patchTimeGroups", patches: patches(A, [0], null) };
  a.graph.applyTimeGroupPatches(opA.patches);
  b.graph.applyTimeGroupPatches(opB.patches);
  for (const client of [a, b]) {
    client.receive({
      type: "op",
      seq: 2,
      clientId: b.collab.selfClientId,
      op: opB,
    });
    client.receive({
      type: "op",
      seq: 1,
      clientId: a.collab.selfClientId,
      op: opA,
    });
  }
  assert.deepEqual(a.graph.nodes, b.graph.nodes);
  assert.equal(a.graph.getNode(0).data[A], undefined);
});

test("same-session reconnect skips old group patches and never resurrects a deleted membership", () => {
  const { graph, history, collab, receive } = collaborationFixture();
  const add = {
    seq: 1,
    clientId: "peer",
    op: { t: "patchTimeGroups", patches: patches(A, [0]) },
  };
  const remove = {
    seq: 2,
    clientId: collab.selfClientId,
    op: { t: "patchTimeGroups", patches: patches(A, [0], null) },
  };
  receive({ type: "op", ...add });
  receive({ type: "op", ...remove });
  assert.equal(graph.getNode(0).data[A], undefined);
  let changes = 0;
  graph.onChange.subscribe(() => changes++);
  receive({ type: "init", seq: 2, oplog: [add, remove], users: [] });
  receive({ type: "op", ...add });
  assert.equal(changes, 0, "no transient resurrection or redundant autosave");
  assert.equal(graph.getNode(0).data[A], undefined);
  assert.equal(history.canUndo, false);
  receive({ type: "init", seq: 2, oplog: [], users: [] });
  receive({
    type: "op",
    seq: 3,
    clientId: "peer",
    op: { t: "patchTimeGroups", patches: patches(B, [0], "new") },
  });
  assert.equal(graph.getNode(0).data[B].value, "new");
});

test("legacy own acknowledgement is still ignored but advances the group sequencing watermark", () => {
  const { graph, collab, receive } = collaborationFixture();
  const old = structuredClone(graph.getNode(0));
  graph.updateNode({ ...old, left: 75 });
  receive({
    type: "op",
    seq: 1,
    clientId: collab.selfClientId,
    op: { t: "updateNode", node: old },
  });
  receive({
    type: "op",
    seq: 2,
    clientId: "peer",
    op: { t: "patchTimeGroups", patches: patches(A, [0]) },
  });
  assert.equal(graph.getNode(0).left, 75);
  assert.equal(graph.getNode(0).data[A].value, "a");
});
