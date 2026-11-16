import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai";
import { SimpleEventDispatcher } from "strongly-typed-events";
import { Node } from "../../mung/Node";
import { UNCERTAIN_CLASS_NAME } from "../../mung/ontology/mungClasses";
import { ClassVisibilityStore } from "../model/ClassVisibilityStore";
import { NotationGraphStore } from "../model/notation-graph-store/NotationGraphStore";
import { StaffGeometryStore } from "../model/StaffGeometryStore";
import { HighlightController } from "./HighlightController";
import type { MousePointerController } from "./MousePointerController";
import { ToolbeltController } from "./ToolbeltController";

function node(id: number, className: string): Node {
  return {
    id,
    className,
    left: id * 20,
    top: 20,
    width: 10,
    height: 10,
    syntaxInlinks: [],
    syntaxOutlinks: [],
    precedenceInlinks: [],
    precedenceOutlinks: [],
    decodedMask: null,
    polygon: null,
    data: {},
    textTranscription: null,
  };
}

function fixture(initializeVisibility = true) {
  const jotai = createStore();
  const graph = new NotationGraphStore(
    [node(1, "noteheadBlack"), node(2, "stem"), node(3, UNCERTAIN_CLASS_NAME)],
    { dataset: "synthetic", document: "hover-focus" },
    jotai,
  );
  const visibility = new ClassVisibilityStore(graph, jotai);
  if (initializeVisibility) visibility.showAllClasses();
  const pointerEvents = new SimpleEventDispatcher<DOMPointReadOnly>();
  // only the pointer event source is stubbed
  const pointer = {
    onScenePointerChange: pointerEvents.asEvent(),
  } as MousePointerController;
  const highlighter = new HighlightController(
    jotai,
    graph,
    visibility,
    pointer,
    new ToolbeltController(jotai),
    new StaffGeometryStore(graph),
  );
  const hover = (id: number) => {
    const target = graph.getNode(id)!;
    pointerEvents.dispatch({
      x: target.left + 5,
      y: target.top + 5,
    } as DOMPointReadOnly);
  };
  return { jotai, graph, visibility, highlighter, hover };
}

test("notehead focus immediately clears an existing non-notehead hover without pointer movement", () => {
  const { highlighter, visibility, jotai, hover } = fixture();
  hover(2);
  assert.equal(jotai.get(highlighter.highlightedNodeAtom)?.className, "stem");
  visibility.setNoteheadsOnly(true);
  assert.equal(highlighter.highlightedNode, null);
  assert.equal(jotai.get(highlighter.highlightedNodeAtom), null);
  hover(2);
  assert.equal(highlighter.highlightedNode, null);
  hover(1);
  assert.equal(highlighter.highlightedNode?.id, 1);
});

test("same-ID class and geometry updates replace the highlighted object and reactive value", () => {
  const { highlighter, graph, visibility, jotai, hover } = fixture();
  visibility.setNoteheadsOnly(true);
  hover(1);
  const previous = jotai.get(highlighter.highlightedNodeAtom)!;
  graph.updateNode({
    ...graph.getNode(1)!,
    className: "noteheadHalf",
    width: 15,
  });
  assert.notEqual(highlighter.highlightedNode, previous);
  assert.equal(highlighter.highlightedNode, graph.getNode(1));
  assert.equal(
    jotai.get(highlighter.highlightedNodeAtom)?.className,
    "noteheadHalf",
  );
  assert.equal(jotai.get(highlighter.highlightedNodeAtom)?.width, 15);
});

test("a hovered notehead reclassified to a hidden class loses hover immediately", () => {
  const { highlighter, graph, visibility, jotai, hover } = fixture();
  visibility.setNoteheadsOnly(true);
  hover(1);
  jotai.get(highlighter.highlightedNodeAtom);
  graph.updateNode({ ...graph.getNode(1)!, className: "stem" });
  assert.equal(highlighter.highlightedNode, null);
  assert.equal(jotai.get(highlighter.highlightedNodeAtom), null);
});

test("manual visibility and uncertainty review also remove now-hidden hover", () => {
  const { highlighter, visibility, hover, graph } = fixture();
  hover(1);
  visibility.setClassVisibility("noteheadBlack", false);
  assert.equal(highlighter.highlightedNode, null);
  hover(2);
  visibility.setUncertainOnly(true);
  assert.equal(highlighter.highlightedNode, null);
  hover(3);
  assert.equal(highlighter.highlightedNode?.id, 3);
  graph.updateNode({ ...graph.getNode(3)!, className: "noteheadBlack" });
  assert.equal(highlighter.highlightedNode, null);
});

test("unrelated visibility changes do not hide a lazily initialized default-visible class", () => {
  const { highlighter, graph, visibility } = fixture(false);
  const stem = graph.getNode(2)!;
  highlighter.setHighlightedNode(stem);
  assert.equal(visibility.visibleClasses.has("stem"), false);
  visibility.setClassVisibility("staffLine", false);
  assert.equal(highlighter.highlightedNode, stem);
  visibility.setNoteheadsOnly(true);
  assert.equal(highlighter.highlightedNode, null);
});

test("hover invalidation does not change graph data or mark annotations dirty", () => {
  const { highlighter, graph, visibility, hover } = fixture();
  const before = structuredClone(graph.nodes);
  let changes = 0;
  graph.onChange.subscribe(() => changes++);
  hover(2);
  visibility.setNoteheadsOnly(true);
  assert.equal(highlighter.highlightedNode, null);
  assert.deepEqual(graph.nodes, before);
  assert.equal(changes, 0);
});
