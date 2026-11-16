import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai";
import { Node } from "../../mung/Node";
import { isNotehead } from "../../mung/TimeGroups";
import { UNCERTAIN_CLASS_NAME } from "../../mung/ontology/mungClasses";
import { ClassVisibilityStore } from "./ClassVisibilityStore";
import { NotationGraphStore } from "./notation-graph-store/NotationGraphStore";

function node(id: number, className: string): Node {
  return {
    id,
    className,
    top: 20,
    left: 10 * id,
    width: 5,
    height: 5,
    syntaxOutlinks: [],
    syntaxInlinks: [],
    precedenceOutlinks: [],
    precedenceInlinks: [],
    decodedMask: null,
    textTranscription: null,
    polygon: null,
    data: { fixture: { type: "str", value: "keep me" } },
  };
}

function fixture() {
  const jotai = createStore();
  const graph = new NotationGraphStore(
    [
      node(1, "noteheadBlack"),
      node(2, "noteheadWholeSmall"),
      node(3, "stem"),
      node(4, "accidentalSharp"),
      node(5, "staffLine"),
      node(6, UNCERTAIN_CLASS_NAME),
    ],
    { dataset: "synthetic", document: "focus-view" },
    jotai,
  );
  const visibility = new ClassVisibilityStore(graph, jotai);
  for (const className of graph.classNames) {
    visibility.getIsClassVisibleAtom(className);
  }
  return { graph, visibility, jotai };
}

test("notehead focus shows every notehead and restores exact manual visibility", () => {
  const { graph, visibility, jotai } = fixture();
  visibility.setClassVisibility("noteheadBlack", false);
  visibility.setClassVisibility("staffLine", true);
  const beforeVisible = new Set(visibility.visibleClasses);
  const beforeHidden = new Set(visibility.hiddenClasses);
  const watched = graph.classNames.map(
    (name) => [name, visibility.getIsClassVisibleAtom(name)] as const,
  );
  // Read first to verify subscribed atom values update with the mode.
  for (const [, atom] of watched) jotai.get(atom);

  jotai.set(visibility.isNoteheadsOnlyAtom, true);
  assert.equal(visibility.isNoteheadsOnly, true);
  for (const [className, atom] of watched) {
    const expected = isNotehead({ className });
    assert.equal(jotai.get(atom), expected, className);
    assert.equal(visibility.visibleClasses.has(className), expected);
    assert.equal(visibility.hiddenClasses.has(className), !expected);
  }

  jotai.set(visibility.isNoteheadsOnlyAtom, false);
  assert.equal(visibility.isNoteheadsOnly, false);
  assert.deepEqual(visibility.visibleClasses, beforeVisible);
  assert.deepEqual(visibility.hiddenClasses, beforeHidden);
});

test("enabling focus works before lazy per-class atoms have been requested", () => {
  const graph = new NotationGraphStore(
    [node(1, "noteheadBlack"), node(2, "stem")],
    { dataset: "synthetic", document: "no-view-yet" },
    createStore(),
  );
  const visibility = new ClassVisibilityStore(graph, createStore());
  visibility.setNoteheadsOnly(true);
  assert.equal(visibility.visibleClasses.has("noteheadBlack"), true);
  assert.equal(visibility.hiddenClasses.has("stem"), true);
});

test("new and reclassified notes stay filtered and preserve base defaults", () => {
  const { graph, visibility, jotai } = fixture();
  visibility.setNoteheadsOnly(true);
  graph.insertNode(node(7, "noteheadHalfSmall"));
  graph.insertNode(node(8, "beamStructural"));
  assert.equal(visibility.visibleClasses.has("noteheadHalfSmall"), true);
  assert.equal(visibility.visibleClasses.has("beamStructural"), false);
  assert.equal(visibility.hiddenClasses.has("beamStructural"), true);

  graph.updateNode({ ...graph.getNode(1)!, className: "slur" });
  visibility.ensureEditedClassIsVisible("slur");
  assert.equal(jotai.get(visibility.getIsClassVisibleAtom("slur")), false);
  graph.updateNode({ ...graph.getNode(3)!, className: "noteheadDoubleWhole" });
  visibility.ensureEditedClassIsVisible("noteheadDoubleWhole");
  assert.equal(
    jotai.get(visibility.getIsClassVisibleAtom("noteheadDoubleWhole")),
    true,
  );
  assert.equal(visibility.isNoteheadsOnly, true);

  visibility.setNoteheadsOnly(false);
  assert.equal(visibility.visibleClasses.has("beamStructural"), true);
  assert.equal(visibility.visibleClasses.has("slur"), true);
  assert.equal(visibility.visibleClasses.has("noteheadDoubleWhole"), true);
  assert.equal(visibility.visibleClasses.has("staffLine"), false);
});

test("focus temporarily suspends uncertainty review then restores it and its base", () => {
  const { visibility, jotai, graph } = fixture();
  visibility.setClassVisibility("noteheadBlack", false);
  visibility.setUncertainOnly(true);
  visibility.setNoteheadsOnly(true);
  assert.equal(jotai.get(visibility.isUncertainOnlyAtom), false);
  assert.equal(jotai.get(visibility.isNoteheadsOnlyAtom), true);
  assert.equal(visibility.visibleClasses.has(UNCERTAIN_CLASS_NAME), false);
  graph.insertNode(node(7, "dynamicPiano"));
  visibility.setNoteheadsOnly(false);
  assert.equal(jotai.get(visibility.isUncertainOnlyAtom), true);
  assert.equal(visibility.visibleClasses.has(UNCERTAIN_CLASS_NAME), true);
  assert.equal(visibility.visibleClasses.has("dynamicPiano"), false);
  visibility.setUncertainOnly(false);
  assert.equal(visibility.visibleClasses.has("noteheadBlack"), false);
  assert.equal(visibility.visibleClasses.has("dynamicPiano"), true);
});

test("explicit uncertainty review exits notehead focus without stale restoration", () => {
  const { visibility, jotai } = fixture();
  visibility.setUncertainOnly(true);
  visibility.setNoteheadsOnly(true);
  visibility.setUncertainOnly(true);
  assert.equal(jotai.get(visibility.isNoteheadsOnlyAtom), false);
  assert.equal(jotai.get(visibility.isUncertainOnlyAtom), true);
  visibility.setUncertainOnly(false);
  visibility.setNoteheadsOnly(true);
  visibility.setNoteheadsOnly(false);
  assert.equal(visibility.isUncertainOnly, false);
});

for (const [name, action] of [
  [
    "single class",
    (v: ClassVisibilityStore) => v.setClassVisibility("stem", false),
  ],
  ["show all", (v: ClassVisibilityStore) => v.showAllClasses()],
  ["hide all", (v: ClassVisibilityStore) => v.hideAllClasses()],
  [
    "show preset",
    (v: ClassVisibilityStore) => v.showOnlyTheseClasses(["stem"]),
  ],
  [
    "hide preset",
    (v: ClassVisibilityStore) => v.hideOnlyTheseClasses(["stem"]),
  ],
] as const) {
  test(`manual ${name} action exits both temporary filters`, () => {
    const { visibility, jotai } = fixture();
    visibility.setUncertainOnly(true);
    visibility.setNoteheadsOnly(true);
    action(visibility);
    assert.equal(jotai.get(visibility.isNoteheadsOnlyAtom), false);
    assert.equal(jotai.get(visibility.isUncertainOnlyAtom), false);
    visibility.setNoteheadsOnly(true);
    visibility.setNoteheadsOnly(false);
    assert.equal(visibility.isUncertainOnly, false);
  });
}

test("view toggles leave all annotation data unchanged and emit no graph changes", () => {
  const { graph, visibility } = fixture();
  const before = structuredClone(graph.nodes);
  let changes = 0;
  graph.onChange.subscribe(() => changes++);
  visibility.setNoteheadsOnly(true);
  visibility.setNoteheadsOnly(false);
  visibility.setUncertainOnly(true);
  visibility.setNoteheadsOnly(true);
  visibility.setNoteheadsOnly(false);
  visibility.setUncertainOnly(false);
  assert.deepEqual(graph.nodes, before);
  assert.equal(changes, 0);
});
