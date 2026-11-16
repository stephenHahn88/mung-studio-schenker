import assert from "node:assert/strict";
import test from "node:test";
import { resolveInferenceFlag } from "./featureFlags";

test("inference defaults to enabled when no flag is configured", () => {
  assert.equal(resolveInferenceFlag(undefined, undefined), true);
});

test("a scoped inference flag overrides the legacy global flag", () => {
  assert.equal(resolveInferenceFlag("true", "false"), true);
  assert.equal(resolveInferenceFlag("false", "true"), false);
});

test("the legacy flag is used when a scoped flag is absent", () => {
  assert.equal(resolveInferenceFlag(undefined, "false"), false);
  assert.equal(resolveInferenceFlag(undefined, "true"), true);
});

test("all documented false values are case-insensitive", () => {
  for (const value of ["0", "false", "FALSE", "no", "NO", "off", "OFF"]) {
    assert.equal(resolveInferenceFlag(value, undefined), false);
  }
});
