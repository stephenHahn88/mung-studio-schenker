import { atom } from "jotai";
import {
  MUNG_CLASS_NAMES,
  UNCERTAIN_CLASS_NAME,
} from "../../mung/ontology/mungClasses";
import { JotaiStore } from "./JotaiStore";

export type AddCustomClassCallback = (className: string) => Promise<string>;
export type SetClassColorCallback = (
  className: string,
  color: string | null,
) => Promise<Readonly<Record<string, string>>>;

const CLASS_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function normalizeNewClassName(rawValue: string): string {
  const className = rawValue.trim();
  if (!className) throw new Error("Class name cannot be empty.");
  if (!CLASS_NAME_PATTERN.test(className)) {
    throw new Error(
      "Use 1-64 letters, numbers, underscores, or hyphens, starting with a letter. Camel case is recommended.",
    );
  }
  if (className.toLowerCase() === "unknown") {
    throw new Error("'unknown' is reserved by MuNG Studio.");
  }
  return className;
}

function mergeClassNames(customClassNames: readonly string[]): string[] {
  const names = new Set<string>(MUNG_CLASS_NAMES);
  customClassNames.forEach((name) => names.add(name));
  return [
    UNCERTAIN_CLASS_NAME,
    ...Array.from(names)
      .filter((name) => name !== UNCERTAIN_CLASS_NAME)
      .sort((a, b) => a.localeCompare(b)),
  ];
}

/** Shared vocabulary available in the class picker for this editor session. */
export class ClassCatalogStore {
  private readonly jotaiStore: JotaiStore;
  private addCallback: AddCustomClassCallback | null = null;
  private colorPersistenceCallback: SetClassColorCallback | null = null;

  public readonly customClassNamesAtom;
  public readonly allClassNamesAtom;
  public readonly canAddClassesAtom = atom<boolean>(false);
  public readonly classColorOverridesAtom;
  public readonly canSetClassColorsAtom = atom<boolean>(false);

  constructor(
    jotaiStore: JotaiStore,
    initialCustomClassNames: readonly string[] = [],
    initialClassColorOverrides: Readonly<Record<string, string>> = {},
  ) {
    this.jotaiStore = jotaiStore;
    this.customClassNamesAtom = atom<readonly string[]>([
      ...initialCustomClassNames,
    ]);
    this.allClassNamesAtom = atom((get) =>
      mergeClassNames(get(this.customClassNamesAtom)),
    );
    this.classColorOverridesAtom = atom<Readonly<Record<string, string>>>({
      ...initialClassColorOverrides,
    });
  }

  public setColorCallback(callback: SetClassColorCallback | null): void {
    this.colorPersistenceCallback = callback;
    this.jotaiStore.set(this.canSetClassColorsAtom, callback !== null);
  }

  public setAddCallback(callback: AddCustomClassCallback | null): void {
    this.addCallback = callback;
    this.jotaiStore.set(this.canAddClassesAtom, callback !== null);
  }

  public setCustomClassNames(classNames: readonly string[]): void {
    this.jotaiStore.set(this.customClassNamesAtom, [...classNames]);
  }

  public setClassColorOverrides(
    overrides: Readonly<Record<string, string>>,
  ): void {
    this.jotaiStore.set(this.classColorOverridesAtom, { ...overrides });
  }

  public async addCustomClass(rawValue: string): Promise<string> {
    const className = normalizeNewClassName(rawValue);
    const existingName = this.jotaiStore
      .get(this.allClassNamesAtom)
      .find((name) => name.toLowerCase() === className.toLowerCase());
    if (existingName !== undefined) {
      throw new Error(`Class '${existingName}' already exists.`);
    }
    if (this.addCallback === null) {
      throw new Error("Adding shared classes is unavailable in this editor.");
    }

    const savedName = normalizeNewClassName(await this.addCallback(className));
    const customNames = this.jotaiStore.get(this.customClassNamesAtom);
    if (!customNames.includes(savedName)) {
      this.jotaiStore.set(this.customClassNamesAtom, [
        ...customNames,
        savedName,
      ]);
    }
    return savedName;
  }

  public async setClassColor(
    className: string,
    color: string | null,
  ): Promise<void> {
    if (!this.jotaiStore.get(this.allClassNamesAtom).includes(className)) {
      throw new Error(`Unknown class '${className}'.`);
    }
    if (this.colorPersistenceCallback === null) {
      throw new Error("Changing shared class colors is unavailable.");
    }
    if (color !== null && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      throw new Error("Color must use #RRGGBB format.");
    }
    const overrides = await this.colorPersistenceCallback(
      className,
      color === null ? null : color.toUpperCase(),
    );
    this.setClassColorOverrides(overrides);
  }
}
