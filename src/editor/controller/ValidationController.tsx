import { atom } from "jotai";
import { PythonRuntime } from "../../../pyodide/PythonRuntime";
import { NotationGraphStore } from "../model/notation-graph-store/NotationGraphStore";
import { ValidationStore } from "../model/ValidationStore";
import { writeMungXmlString } from "../../mung/writeMungXmlString";
import { JotaiStore } from "../model/JotaiStore";
import { ValidationIssue } from "../model/ValidationIssue";
import { DeltaInterpreter } from "../model/DeltaInterpreter";
import { ClassCatalogStore } from "../model/ClassCatalogStore";

/**
 * Contains the logic behind mung validation, running in the background.
 */
export class ValidationController {
  private readonly jotaiStore: JotaiStore;

  private readonly validationStore: ValidationStore;
  private readonly notationGraphStore: NotationGraphStore;
  private readonly pythonRuntime: PythonRuntime;
  private readonly deltaInterpreter: DeltaInterpreter;
  private readonly classCatalogStore: ClassCatalogStore;

  constructor(
    jotaiStore: JotaiStore,
    validationStore: ValidationStore,
    notationGraphStore: NotationGraphStore,
    pythonRuntime: PythonRuntime,
    deltaInterpreter: DeltaInterpreter,
    classCatalogStore: ClassCatalogStore,
  ) {
    this.jotaiStore = jotaiStore;
    this.validationStore = validationStore;
    this.notationGraphStore = notationGraphStore;
    this.pythonRuntime = pythonRuntime;
    this.deltaInterpreter = deltaInterpreter;
    this.classCatalogStore = classCatalogStore;
  }

  // TODO: observe changes to the graph, debounce, and trigger validations

  /**
   * Controls whether the validation panel is open
   */
  public readonly isValidationPanelOpenAtom = atom<boolean>(false);

  ////////////////////////
  // Validation process //
  ////////////////////////

  /**
   * Signals whether the validation is currently running or not
   */
  public readonly isValidationRunningAtom = atom<boolean>(false);

  public startValidation(): void {
    // do nothing if a validation is already running
    if (this.jotaiStore.get(this.isValidationRunningAtom)) return;

    // start the validation process
    this.jotaiStore.set(this.isValidationRunningAtom, true);
    const mungXml = writeMungXmlString(this.notationGraphStore.getMungFile());
    const promise = this.pythonRuntime.mungValidation.runValidation(mungXml);

    // when it finishes
    promise
      .then((issues: ValidationIssue[]) => {
        // custom classes are not reported as unknown class names
        const customClasses = new Set(
          this.jotaiStore.get(this.classCatalogStore.customClassNamesAtom),
        );
        const relevantIssues = issues.filter((issue) => {
          if (issue.code !== 5002) return true;
          if (!this.notationGraphStore.hasNode(issue.nodeId)) return true;
          return !customClasses.has(
            this.notationGraphStore.getNode(issue.nodeId).className,
          );
        });
        this.validationStore.acceptNewerIssues(relevantIssues);
      })
      .catch((e) => {
        // display error in the UI and the console
        this.validationStore.acceptErrorMessage(e?.toString() || String(e));
        console.error(e);
      })
      .finally(() => {
        // validation has finished
        this.jotaiStore.set(this.isValidationRunningAtom, false);
      });
  }

  //////////////////////
  // Issue resolution //
  //////////////////////

  public resolveIssues(issues: ValidationIssue[]): void {
    for (const issue of issues) {
      if (!issue.resolution) continue; // skip non-fixable issues

      this.deltaInterpreter.applyDelta(issue.resolution);
      this.validationStore.forgetIssue(issue);
    }
  }
}
