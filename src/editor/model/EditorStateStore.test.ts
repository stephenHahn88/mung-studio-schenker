import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai";
import { EditorStateStore } from "./EditorStateStore";

for (const [syntaxVisible, precedenceVisible] of [
  [true, true],
  [true, false],
  [false, true],
  [false, false],
] as const) {
  test(`temporary edge hiding preserves ${syntaxVisible}/${precedenceVisible} visibility`, () => {
    const jotaiStore = createStore();
    const editorStateStore = new EditorStateStore(jotaiStore);

    jotaiStore.set(editorStateStore.displaySyntaxLinksAtom, syntaxVisible);
    jotaiStore.set(
      editorStateStore.displayPrecedenceLinksAtom,
      precedenceVisible,
    );

    jotaiStore.set(editorStateStore.hideAllEdgesAtom, true);
    assert.equal(editorStateStore.isDisplaySyntaxLinks, false);
    assert.equal(editorStateStore.isDisplayPrecedenceLinks, false);

    jotaiStore.set(editorStateStore.hideAllEdgesAtom, false);
    assert.equal(editorStateStore.isDisplaySyntaxLinks, syntaxVisible);
    assert.equal(editorStateStore.isDisplayPrecedenceLinks, precedenceVisible);
    assert.equal(
      jotaiStore.get(editorStateStore.displaySyntaxLinksAtom),
      syntaxVisible,
    );
    assert.equal(
      jotaiStore.get(editorStateStore.displayPrecedenceLinksAtom),
      precedenceVisible,
    );
  });
}
