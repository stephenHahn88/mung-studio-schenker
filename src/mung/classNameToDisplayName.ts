import { UNCERTAIN_CLASS_NAME } from "./ontology/mungClasses";

/** Class name shown in the annotation UI ("Uncertain" for unclassified). */
export function classNameToDisplayName(className: string): string {
  if (className === UNCERTAIN_CLASS_NAME) return "Uncertain";
  return className;
}

/** Maps the typed label "Uncertain" to the MuNG class name. */
export function normalizeClassNameInput(className: string): string {
  const normalized = className.trim().toLowerCase();
  if (
    normalized === "uncertain" ||
    normalized === "uncertain (unclassified)" ||
    normalized === UNCERTAIN_CLASS_NAME
  ) {
    return UNCERTAIN_CLASS_NAME;
  }
  return className;
}
