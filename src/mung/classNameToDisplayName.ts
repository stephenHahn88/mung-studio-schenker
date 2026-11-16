import { UNCERTAIN_CLASS_NAME } from "./ontology/mungClasses";

/**
 * Human-friendly class labels for the annotation UI. MuNG XML continues to
 * store the canonical class name, so display aliases never change the data.
 */
export function classNameToDisplayName(className: string): string {
  if (className === UNCERTAIN_CLASS_NAME) return "Uncertain";
  return className;
}

/**
 * Accept the friendly uncertainty label when entered through the free-form
 * class picker, while persisting the canonical MuNG class name.
 */
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
