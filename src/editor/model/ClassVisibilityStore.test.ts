import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai";
import { Node } from "../../mung/Node";
import { UNCERTAIN_CLASS_NAME } from "../../mung/ontology/mungClasses";
import { ClassVisibilityStore } from "./ClassVisibilityStore";
import { NotationGraphStore } from "./notation-graph-store/NotationGraphStore";

function node(id: number, className: string): Node {
  return {
    id,
    className,
    top: id * 10,
    left: id * 10,
    width: 5,
    height: 5,
    syntaxOutlinks: [],
    syntaxInlinks: [],
    precedenceOutlinks: [],
    precedenceInlinks: [],
    decodedMask: null,
    textTranscription: null,
    data: {},
    polygon: null,
  };
}

function fixture() {
  const jotaiStore = createStore();
  const graph = new NotationGraphStore(
    [
      node(1, "noteheadFull"),
      node(2, "staffLine"),
      node(3, UNCERTAIN_CLASS_NAME),
    ],
    { dataset: "test", document: "test" },
    jotaiStore,
  );
  const visibility = new ClassVisibilityStore(graph, jotaiStore);
  return { jotaiStore, graph, visibility };
}

test("uncertain-only view restores exact previous class visibility", () => {
  const { jotaiStore, visibility } = fixture();
  const noteheadVisible = visibility.getIsClassVisibleAtom("noteheadFull");
  const staffVisible = visibility.getIsClassVisibleAtom("staffLine");
  const uncertainVisible =
    visibility.getIsClassVisibleAtom(UNCERTAIN_CLASS_NAME);

  jotaiStore.set(noteheadVisible, false);
  jotaiStore.set(staffVisible, true);
  assert.equal(jotaiStore.get(noteheadVisible), false);
  assert.equal(jotaiStore.get(staffVisible), true);
  assert.equal(jotaiStore.get(uncertainVisible), true);

  jotaiStore.set(visibility.isUncertainOnlyAtom, true);
  assert.equal(jotaiStore.get(visibility.isUncertainOnlyAtom), true);
  assert.equal(jotaiStore.get(noteheadVisible), false);
  assert.equal(jotaiStore.get(staffVisible), false);
  assert.equal(jotaiStore.get(uncertainVisible), true);

  jotaiStore.set(visibility.isUncertainOnlyAtom, false);
  assert.equal(jotaiStore.get(noteheadVisible), false);
  assert.equal(jotaiStore.get(staffVisible), true);
  assert.equal(jotaiStore.get(uncertainVisible), true);
});

test("classes added during uncertain-only view stay filtered then use defaults", () => {
  const { jotaiStore, graph, visibility } = fixture();
  jotaiStore.set(visibility.isUncertainOnlyAtom, true);

  graph.insertNode(node(4, "newReviewableClass"));
  const newClassVisible =
    visibility.getIsClassVisibleAtom("newReviewableClass");
  assert.equal(jotaiStore.get(newClassVisible), false);

  jotaiStore.set(visibility.isUncertainOnlyAtom, false);
  assert.equal(jotaiStore.get(newClassVisible), true);
});

test("manual visibility actions leave the temporary uncertain-only view", () => {
  const { jotaiStore, graph, visibility } = fixture();
  jotaiStore.set(visibility.isUncertainOnlyAtom, true);

  visibility.showAllClasses();

  assert.equal(jotaiStore.get(visibility.isUncertainOnlyAtom), false);
  for (const className of graph.classNames) {
    assert.equal(
      jotaiStore.get(visibility.getIsClassVisibleAtom(className)),
      true,
    );
  }
});

test("resolving an uncertain node does not leave the review filter", () => {
  const { jotaiStore, visibility } = fixture();
  const resolvedClassVisible = visibility.getIsClassVisibleAtom("noteheadFull");
  jotaiStore.set(resolvedClassVisible, false);
  jotaiStore.set(visibility.isUncertainOnlyAtom, true);

  visibility.ensureEditedClassIsVisible("noteheadFull");

  assert.equal(jotaiStore.get(visibility.isUncertainOnlyAtom), true);
  assert.equal(jotaiStore.get(resolvedClassVisible), false);
  jotaiStore.set(visibility.isUncertainOnlyAtom, false);
  assert.equal(jotaiStore.get(resolvedClassVisible), true);
});
