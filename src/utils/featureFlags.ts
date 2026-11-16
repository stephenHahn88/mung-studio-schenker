const falseValues = new Set(["0", "false", "no", "off"]);

/**
 * Resolve an inference flag: the scoped value, else MUNG_ENABLE_INFERENCE,
 * else enabled.
 */
export function resolveInferenceFlag(
  scopedValue: string | undefined,
  globalValue: string | undefined,
): boolean {
  return !falseValues.has((scopedValue ?? globalValue ?? "true").toLowerCase());
}

const GLOBAL_INFERENCE_FLAG = process.env["MUNG_ENABLE_INFERENCE"];

/** Symbol detection (detect-symbols). */
export const SYMBOL_INFERENCE_ENABLED = resolveInferenceFlag(
  process.env["MUNG_ENABLE_SYMBOL_INFERENCE"],
  GLOBAL_INFERENCE_FLAG,
);

/** Syntax links, time groups and precedence links. */
export const RELATION_INFERENCE_ENABLED = resolveInferenceFlag(
  process.env["MUNG_ENABLE_RELATION_INFERENCE"],
  GLOBAL_INFERENCE_FLAG,
);

export const SYMBOL_INFERENCE_UNAVAILABLE_MESSAGE =
  "Symbol detection is not enabled in this build. You can continue manual annotation and clear existing predictions.";

export const RELATION_INFERENCE_UNAVAILABLE_MESSAGE =
  "Relation prediction is not enabled in this build. You can continue adding and editing links and time groups manually.";
