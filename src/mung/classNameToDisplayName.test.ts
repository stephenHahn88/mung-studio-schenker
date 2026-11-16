import assert from "node:assert/strict";
import test from "node:test";
import {
  classNameToDisplayName,
  normalizeClassNameInput,
} from "./classNameToDisplayName";
import { UNCERTAIN_CLASS_NAME } from "./ontology/mungClasses";

test("canonical unclassified class is presented as Uncertain", () => {
  assert.equal(classNameToDisplayName(UNCERTAIN_CLASS_NAME), "Uncertain");
  assert.equal(classNameToDisplayName("noteheadFull"), "noteheadFull");
});

test("friendly uncertainty input saves the canonical MuNG class", () => {
  assert.equal(normalizeClassNameInput("Uncertain"), UNCERTAIN_CLASS_NAME);
  assert.equal(normalizeClassNameInput("unclassified"), UNCERTAIN_CLASS_NAME);
  assert.equal(normalizeClassNameInput("noteheadFull"), "noteheadFull");
});
