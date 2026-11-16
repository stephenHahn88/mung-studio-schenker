import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai";
import { ClassCatalogStore, normalizeNewClassName } from "./ClassCatalogStore";
import { UNCERTAIN_CLASS_NAME } from "../../mung/ontology/mungClasses";

test("custom classes are merged into the picker and Uncertain stays first", () => {
  const jotaiStore = createStore();
  const catalog = new ClassCatalogStore(jotaiStore, ["newSchenkerSymbol"]);
  const names = jotaiStore.get(catalog.allClassNamesAtom);
  assert.equal(names[0], UNCERTAIN_CLASS_NAME);
  assert.ok(names.includes("newSchenkerSymbol"));
  assert.ok(names.includes("noteheadFull"));
});

test("adding a class persists through the callback and updates the picker", async () => {
  const jotaiStore = createStore();
  const catalog = new ClassCatalogStore(jotaiStore);
  const added: string[] = [];
  catalog.setAddCallback(async (name) => {
    added.push(name);
    return name;
  });

  assert.equal(
    await catalog.addCustomClass("  prolongationBracket  "),
    "prolongationBracket",
  );
  assert.deepEqual(added, ["prolongationBracket"]);
  assert.ok(
    jotaiStore.get(catalog.allClassNamesAtom).includes("prolongationBracket"),
  );
});

test("invalid and duplicate class names are rejected before persistence", async () => {
  assert.throws(() => normalizeNewClassName("two words"));
  assert.throws(() => normalizeNewClassName("9symbol"));
  assert.throws(() => normalizeNewClassName("unknown"));

  const jotaiStore = createStore();
  const catalog = new ClassCatalogStore(jotaiStore, ["customArc"]);
  catalog.setAddCallback(async (name) => name);
  await assert.rejects(
    () => catalog.addCustomClass("CustomArc"),
    /already exists/,
  );
  await assert.rejects(
    () => catalog.addCustomClass("noteheadfull"),
    /already exists/,
  );
});

test("class colors are persisted, shared in state, and resettable", async () => {
  const jotaiStore = createStore();
  const catalog = new ClassCatalogStore(jotaiStore, [], {
    stem: "#112233",
  });
  const calls: Array<[string, string | null]> = [];
  catalog.setColorCallback(async (className, color) => {
    calls.push([className, color]);
    return color === null ? {} : { [className]: color };
  });

  await catalog.setClassColor("noteheadBlack", "#abcdef");
  assert.deepEqual(calls[0], ["noteheadBlack", "#ABCDEF"]);
  assert.deepEqual(jotaiStore.get(catalog.classColorOverridesAtom), {
    noteheadBlack: "#ABCDEF",
  });

  await catalog.setClassColor("noteheadBlack", null);
  assert.deepEqual(jotaiStore.get(catalog.classColorOverridesAtom), {});
  await assert.rejects(() => catalog.setClassColor("missingClass", "#123456"));
});
