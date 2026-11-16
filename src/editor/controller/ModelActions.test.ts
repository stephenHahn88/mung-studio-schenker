import assert from "node:assert/strict";
import test from "node:test";
import { atom, createStore } from "jotai";
import { MainMenuController } from "./MainMenuController";
import { ModelApi } from "./ModelApi";
import { NotationGraphStore } from "../model/notation-graph-store/NotationGraphStore";
import { SelectionStore } from "../model/SelectionStore";
import { HistoryStore } from "../model/HistoryStore";
import { TimeGroupStore } from "../model/TimeGroupStore";
import { LinkType } from "../../mung/LinkType";
import { collectTimeGroups, TIME_GROUP_PREFIX } from "../../mung/TimeGroups";
import { Node } from "../../mung/Node";
import {
  RELATION_INFERENCE_ENABLED,
  SYMBOL_INFERENCE_ENABLED,
} from "../../utils/featureFlags";

const groupKey = TIME_GROUP_PREFIX + "synthetic";

function node(
  id: number,
  className: string,
  left: number,
  top: number,
  data: Node["data"] = {},
): Node {
  return {
    id,
    className,
    left,
    top,
    width: 10,
    height: 10,
    decodedMask: null,
    polygon: null,
    textTranscription: null,
    syntaxInlinks: [],
    syntaxOutlinks: [],
    precedenceInlinks: [],
    precedenceOutlinks: [],
    data,
  };
}

function predictedNode(grouped: boolean): Node {
  return node(0, "noteheadBlack", 10, 10, {
    symbol_detector_prediction: { type: "str", value: "true" },
    ...(grouped
      ? {
          [groupKey]: {
            type: "str",
            value: "malformed records are protected too",
          },
        }
      : {}),
  });
}

function fixture(nodes: Node[]) {
  const store = createStore();
  const graph = new NotationGraphStore(
    nodes,
    { document: "synthetic", dataset: "test" },
    store,
  );
  const selection = new SelectionStore(graph, store);
  const history = new HistoryStore(graph, store);
  const timeGroups = new TimeGroupStore(graph, selection, store);
  const controller = new MainMenuController(
    store,
    graph,
    selection,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { setClassVisibility() {} } as any,
    {
      imageUrl: "page-fixture",
      widthAtom: atom(300),
      heightAtom: atom(200),
    } as any,
    history,
    timeGroups,
  );
  const alerts: string[] = [];
  const previousWindow = globalThis.window;
  const previousRect = globalThis.DOMRect;
  globalThis.window = {
    alert: (message: string) => alerts.push(message),
    location: { origin: "http://localhost" },
    localStorage: { getItem: () => null },
  } as any;
  globalThis.DOMRect = class {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}
    get left() {
      return this.x;
    }
    get right() {
      return this.x + this.width;
    }
    get top() {
      return this.y;
    }
    get bottom() {
      return this.y + this.height;
    }
  } as any;
  return {
    graph,
    store,
    history,
    selection,
    timeGroups,
    controller,
    alerts,
    restore() {
      globalThis.window = previousWindow;
      globalThis.DOMRect = previousRect;
    },
  };
}

const emptyDetection = {
  model: "synthetic-detector",
  image: { width: 300, height: 200 },
  region: null,
  predictions: [],
};

test("grouped predictions stop detection before the request and stop Clear", async (t) => {
  if (!SYMBOL_INFERENCE_ENABLED) return;
  const f = fixture([predictedNode(true)]);
  t.after(() => f.restore());
  const detect = t.mock.method(
    ModelApi.prototype,
    "detectSymbols",
    async () => {
      throw new Error("must not call model");
    },
  );
  const before = structuredClone(f.graph.nodes);
  await f.controller.runModel("symbols", "Synthetic page");
  f.controller.clearPredictedSymbols();
  assert.equal(detect.mock.callCount(), 0);
  assert.deepEqual(f.graph.nodes, before);
  assert.equal(f.alerts.length, 2);
  assert.match(f.alerts[0], /time-group annotations/);
});

test("grouping during in-flight detection discards its result", async (t) => {
  if (!SYMBOL_INFERENCE_ENABLED) return;
  const f = fixture([predictedNode(false)]);
  t.after(() => f.restore());
  let resolve!: (result: any) => void;
  const pending = new Promise<any>((done) => {
    resolve = done;
  });
  t.mock.method(ModelApi.prototype, "detectSymbols", () => pending);
  const running = f.controller.runModel("symbols", "Synthetic page");
  assert.equal(f.store.get(f.controller.isModelRunningAtom), true);
  f.graph.applyTimeGroupPatches([
    { nodeId: 0, data: { [groupKey]: { type: "str", value: "manual" } } },
  ]);
  const grouped = structuredClone(f.graph.nodes);
  resolve(emptyDetection);
  await running;
  assert.deepEqual(f.graph.nodes, grouped);
  assert.equal(f.store.get(f.controller.isModelRunningAtom), false);
  assert.match(f.alerts[0], /unchanged/);
});

test("detection outside the grouped region is permitted and keeps its notes", async (t) => {
  if (!SYMBOL_INFERENCE_ENABLED) return;
  const f = fixture([predictedNode(true)]);
  t.after(() => f.restore());
  const detect = t.mock.method(
    ModelApi.prototype,
    "detectSymbols",
    async () => emptyDetection,
  );
  const before = structuredClone(f.graph.nodes);
  await f.controller.runModel(
    "symbols",
    "Synthetic page",
    new DOMRect(100, 100, 50, 50),
  );
  assert.equal(detect.mock.callCount(), 1);
  assert.deepEqual(f.graph.nodes, before);
  assert.match(f.alerts[0], /Inserted 0/);
});

test("detection sends the page region and threshold and tags inserted nodes", async (t) => {
  if (!SYMBOL_INFERENCE_ENABLED) return;
  const f = fixture([predictedNode(false), node(5, "stemStructural", 200, 20)]);
  t.after(() => f.restore());
  const detect = t.mock.method(
    ModelApi.prototype,
    "detectSymbols",
    async () => ({
      ...emptyDetection,
      predictions: [
        {
          className: "noteheadHalf",
          left: 12.4,
          top: 8.6,
          width: 9.5,
          height: 11,
          confidence: 0.75,
        },
      ],
    }),
  );
  await f.controller.runModel(
    "symbols",
    "Synthetic page",
    new DOMRect(-20, 0, 100, 50),
    { scoreThreshold: 0.3 },
  );
  const [documentName, region, threshold] = detect.mock.calls[0].arguments;
  assert.equal(documentName, "Synthetic page");
  assert.deepEqual(region, { left: 0, top: 0, width: 80, height: 50 });
  assert.equal(threshold, 0.3);
  // The earlier prediction in the region is replaced; the stem outside stays.
  assert.deepEqual(f.graph.nodes.map((n) => n.className).sort(), [
    "noteheadHalf",
    "stemStructural",
  ]);
  const inserted = f.graph.nodes.find((n) => n.className === "noteheadHalf")!;
  assert.deepEqual(
    [inserted.left, inserted.top, inserted.width, inserted.height],
    [12, 9, 10, 11],
  );
  assert.equal(inserted.data["symbol_detector_prediction"].value, "true");
  assert.equal(
    inserted.data["symbol_detector_model_key"].value,
    "synthetic-detector",
  );
  assert.equal(inserted.data["symbol_detector_confidence"].value, "0.750000");
  f.controller.clearPredictedSymbols();
  assert.deepEqual(
    f.graph.nodes.map((n) => n.className),
    ["stemStructural"],
  );
});

test("a region outside the page is refused without a request", async (t) => {
  if (!SYMBOL_INFERENCE_ENABLED) return;
  const f = fixture([predictedNode(false)]);
  t.after(() => f.restore());
  const detect = t.mock.method(
    ModelApi.prototype,
    "detectSymbols",
    async () => {
      throw new Error("must not call");
    },
  );
  const before = structuredClone(f.graph.nodes);
  await f.controller.runModel(
    "symbols",
    "Synthetic page",
    new DOMRect(-100, 50, 20, 50),
  );
  assert.equal(detect.mock.callCount(), 0);
  assert.deepEqual(f.graph.nodes, before);
  assert.match(f.alerts[0], /does not overlap/);
});

test("a detection result for a different image size is not applied", async (t) => {
  if (!SYMBOL_INFERENCE_ENABLED) return;
  const f = fixture([predictedNode(false)]);
  t.after(() => f.restore());
  t.mock.method(ModelApi.prototype, "detectSymbols", async () => ({
    ...emptyDetection,
    image: { width: 600, height: 400 },
  }));
  const before = structuredClone(f.graph.nodes);
  await f.controller.runModel("symbols", "Synthetic page");
  assert.deepEqual(f.graph.nodes, before);
  assert.match(f.alerts[0], /do not match/);
});

test("syntax links are predicted from the nodes of a region only", async (t) => {
  if (!RELATION_INFERENCE_ENABLED) return;
  const f = fixture([
    node(0, "noteheadBlack", 10, 10),
    node(1, "stemStructural", 20, 0),
    node(2, "slurStructuralUp", 30, 10),
    node(3, "noteheadBlack", 250, 150),
  ]);
  t.after(() => f.restore());
  f.graph.insertLink(1, 0, LinkType.Syntax);
  const predict = t.mock.method(
    ModelApi.prototype,
    "predictSyntaxLinks",
    async () => ({
      model: "synthetic-syntax",
      links: [
        { source: 1, target: 0, score: 0.9 },
        { source: 0, target: 1, score: 0.85 },
        { source: 2, target: 0, score: 0.8 },
        { source: 2, target: 3, score: 0.7 },
        { source: 2, target: 2, score: 0.7 },
      ],
    }),
  );
  await f.controller.runModel(
    "syntaxLinks",
    "Synthetic page",
    new DOMRect(0, 0, 100, 100),
  );
  const sent = predict.mock.calls[0].arguments[1] as readonly { id: number }[];
  assert.deepEqual(
    sent.map((n) => n.id),
    [0, 1, 2],
  );
  assert.deepEqual(
    f.graph.syntaxLinks.map((link) => [link.fromId, link.toId]).sort(),
    [
      [1, 0],
      [2, 0],
    ],
  );
  assert.match(
    f.store.get(f.controller.modelStatusAtom) ?? "",
    /Added 1 predicted syntax/,
  );
});

test("precedence links are inserted as precedence links", async (t) => {
  if (!RELATION_INFERENCE_ENABLED) return;
  const f = fixture([
    node(0, "noteheadBlack", 10, 10),
    node(1, "noteheadBlack", 40, 10),
  ]);
  t.after(() => f.restore());
  t.mock.method(ModelApi.prototype, "predictPrecedence", async () => ({
    model: "synthetic-precedence",
    links: [{ source: 0, target: 1, score: null }],
  }));
  await f.controller.runModel("precedence", "Synthetic page");
  assert.equal(f.graph.syntaxLinks.length, 0);
  assert.equal(f.graph.hasLink(0, 1, LinkType.Precedence), true);
});

test("predicted time groups are created for ungrouped noteheads", async (t) => {
  if (!RELATION_INFERENCE_ENABLED) return;
  const f = fixture([
    node(0, "noteheadBlack", 10, 10),
    node(1, "noteheadBlack", 10, 40),
    node(2, "stemStructural", 20, 10),
    node(3, "noteheadHalf", 60, 10),
  ]);
  t.after(() => f.restore());
  t.mock.method(ModelApi.prototype, "predictTimeGroups", async () => ({
    model: "synthetic-time",
    groups: [[0, 1, 2], [3]],
  }));
  await f.controller.runModel("timeGroups", "Synthetic page");
  const groups = collectTimeGroups(f.graph.nodes);
  assert.deepEqual(
    groups.map((group) => [group.provenance, [...group.memberIds]]).sort(),
    [
      ["predicted", [0, 1]],
      ["predicted", [3]],
    ],
  );
});

test("predicted time groups never change manual groups", async (t) => {
  if (!RELATION_INFERENCE_ENABLED) return;
  const f = fixture([
    node(0, "noteheadBlack", 10, 10),
    node(1, "noteheadBlack", 10, 40),
    node(2, "noteheadBlack", 60, 10),
  ]);
  t.after(() => f.restore());
  f.selection.changeSelection([0]);
  const manual = f.timeGroups.createFromSelection()!;
  const before = collectTimeGroups(f.graph.nodes).find(
    (group) => group.id === manual,
  );
  t.mock.method(ModelApi.prototype, "predictTimeGroups", async () => ({
    model: "synthetic-time",
    groups: [[0, 1], [2]],
  }));
  await f.controller.runModel("timeGroups", "Synthetic page");
  const groups = collectTimeGroups(f.graph.nodes);
  assert.deepEqual(
    groups.find((group) => group.id === manual),
    before,
  );
  assert.deepEqual(
    groups
      .filter((group) => group.provenance === "predicted")
      .map((group) => [...group.memberIds])
      .sort(),
    [[1], [2]],
  );
  assert.match(
    f.store.get(f.controller.modelStatusAtom) ?? "",
    /1 already grouped notehead/,
  );
  f.history.undo();
  assert.deepEqual(
    collectTimeGroups(f.graph.nodes).map((group) => group.id),
    [manual],
  );
});

test("links are not added when the symbols change during prediction", async (t) => {
  if (!RELATION_INFERENCE_ENABLED) return;
  const f = fixture([
    node(0, "noteheadBlack", 10, 10),
    node(1, "stemStructural", 20, 0),
  ]);
  t.after(() => f.restore());
  let resolve!: (result: any) => void;
  const pending = new Promise<any>((done) => {
    resolve = done;
  });
  t.mock.method(ModelApi.prototype, "predictSyntaxLinks", () => pending);
  const running = f.controller.runModel("syntaxLinks", "Synthetic page");
  f.graph.updateNode({ ...f.graph.getNode(0), left: 15 });
  resolve({ model: "m", links: [{ source: 1, target: 0, score: 1 }] });
  await running;
  assert.equal(f.graph.syntaxLinks.length, 0);
  assert.match(
    f.store.get(f.controller.modelStatusAtom) ?? "",
    /changed during prediction/,
  );
});
