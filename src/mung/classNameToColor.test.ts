import assert from "node:assert/strict";
import test from "node:test";
import {
  classNameToColor,
  classNameToDefaultColor,
  hexColorToRgb,
} from "./classNameToColor";

test("class colors are deterministic and accept explicit overrides", () => {
  assert.equal(classNameToDefaultColor("noteheadBlack"), "#FF0051");
  assert.equal(
    classNameToDefaultColor("noteheadBlack"),
    classNameToColor("noteheadBlack"),
  );
  assert.equal(
    classNameToColor("noteheadBlack", { noteheadBlack: "#123456" }),
    "#123456",
  );
});

test("hex colors convert to RGB", () => {
  assert.deepEqual(hexColorToRgb("#12AbEf"), [18, 171, 239]);
  assert.throws(() => hexColorToRgb("red"));
});
