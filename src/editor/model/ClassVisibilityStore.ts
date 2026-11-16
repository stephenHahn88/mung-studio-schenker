import { atom, getDefaultStore, WritableAtom } from "jotai";
import { NotationGraphStore } from "./notation-graph-store/NotationGraphStore";
import { SignalAtomWrapper } from "./SignalAtomWrapper";
import { SignalAtomCollection } from "./SignalAtomCollection";
import { ISimpleEvent, SimpleEventDispatcher } from "strongly-typed-events";
import { UNCERTAIN_CLASS_NAME } from "../../mung/ontology/mungClasses";
import { JotaiStore } from "./JotaiStore";
import { isNotehead } from "../../mung/TimeGroups";

/**
 * Class names that should be hidden in the default visibility state.
 * Those not listed here are visible by default.
 */
export const DEFAULT_HIDDEN_CLASSES = new Set([
  "staffLine",
  "staffSpace",
  "staff",
]);

/**
 * Classes that should be visible when doing precedence link annotation
 */
export const PRECEDENCE_LINK_ANNOTATION_CLASSES = new Set([
  // https://github.com/OmniOMR/mung/blob/main/docs/annotation-instructions/annotation-instructions.md#precedence-graph

  // noteheads
  "noteheadWhole",
  "noteheadHalf",
  "noteheadBlack",
  "noteheadFull",

  // gracenote noteheads (have their own disjoint precedence graph)
  "noteheadWholeSmall",
  "noteheadHalfSmall",
  "noteheadBlackSmall",
  "noteheadFullSmall",

  // rests
  "restLonga",
  "restDoubleWhole",
  "restWhole",
  "restHalf",
  "restQuarter",
  "rest8th",
  "rest16th",
  "rest32nd",
  "rest64th",
  "rest128th",
  "rest256th",
  "rest512th",
  "rest1024th",
  "restHBar",

  // bar repeats
  "repeatOneBar",
  "repeat1Bar",
  "repeat2Bar",
  "repeat4Bar",

  // custos
  "custos",

  // time signatures
  "timeSig0",
  "timeSig1",
  "timeSig2",
  "timeSig3",
  "timeSig4",
  "timeSig5",
  "timeSig6",
  "timeSig7",
  "timeSig8",
  "timeSig9",
  "timeSigSlash",
  "timeSigFractionalSlash",
  "timeSigPlus",
  "timeSigEquals",

  // lyrics
  "lyricsText",
  "lyricsUnisono",

  // dynamic marks
  "dynamicPiano",
  "dynamicMezzo",
  "dynamicForte",
  "dynamicRinforzando",
  "dynamicSforzando",
  "dynamicZ",
  "dynamicNiente",

  // tuplets
  "tuplet0",
  "tuplet1",
  "tuplet2",
  "tuplet3",
  "tuplet4",
  "tuplet5",
  "tuplet6",
  "tuplet7",
  "tuplet8",
  "tuplet9",
  "tupletColon",
]);

/**
 * Classes that should be visible when reviewing links for staves
 */
export const STAVES_REVIEW_ANNOTATION_CLASSES = new Set([
  // https://github.com/OmniOMR/mung/blob/main/docs/annotation-instructions/annotation-instructions.md#1-assignment-to-staves

  "staff",

  // noteheads
  "noteheadWhole",
  "noteheadHalf",
  "noteheadBlack",
  "noteheadFull",

  // gracenote noteheads
  "noteheadWholeSmall",
  "noteheadHalfSmall",
  "noteheadBlackSmall",
  "noteheadFullSmall",

  // rests
  "restLonga",
  "restDoubleWhole",
  "restWhole",
  "restHalf",
  "restQuarter",
  "rest8th",
  "rest16th",
  "rest32nd",
  "rest64th",
  "rest128th",
  "rest256th",
  "rest512th",
  "rest1024th",
  "restHBar",

  // clefs
  "gClef",
  "cClef",
  "fClef",
  "gClefChange",
  "cClefChange",
  "fClefChange",

  // signatures
  "keySignature",
  "timeSignature",

  // bralines & brackets
  "measureSeparator",
  "staffGrouping",

  // repeats
  "repeat1Bar",

  // unisono text
  "unisonoText",
  "unisonoContinuation",

  // system divider
  "systemDivider",

  // custos
  "custos",
]);

/**
 * Classes that should be visible when reviewing links
 * for staff lines and spaces
 */
export const STAFF_LINES_SPACES_ANNOTATION_CLASSES = new Set([
  // https://github.com/OmniOMR/mung/blob/main/docs/annotation-instructions/annotation-instructions.md#2-assignment-to-stafflines-and-staffspaces

  "staffLine",
  "staffSpace",

  // noteheads
  "noteheadWhole",
  "noteheadHalf",
  "noteheadBlack",
  "noteheadFull",

  // grace noteheads
  "noteheadWholeSmall",
  "noteheadHalfSmall",
  "noteheadBlackSmall",

  // clefs
  "gClef",
  "cClef",
  "fClef",
  "gClefChange",
  "cClefChange",
  "fClefChange",

  // custos
  "custos",
]);

export class ClassVisibilityStore {
  /**
   * Jotai store used to access atoms from plain JS
   */
  private readonly jotaiStore: JotaiStore;

  private readonly notationGraphStore: NotationGraphStore;

  constructor(
    notationGraphStore: NotationGraphStore,
    jotaiStore: JotaiStore | null = null,
  ) {
    this.notationGraphStore = notationGraphStore;
    this.jotaiStore = jotaiStore ?? getDefaultStore();

    this.notationGraphStore.onClassNameCountsChange.subscribe(
      this.onClassNamesCountsChange.bind(this),
    );
  }

  private onClassNamesCountsChange() {
    if (this._isUncertainOnly) {
      this.recomputeUncertainOnlyHiddenClasses();
    }
    if (this._isNoteheadsOnly) this.recomputeNoteheadsOnlyClasses();
    for (const className of this.notationGraphStore.classNames) {
      this.ensureHasClass(className);
    }
  }

  ///////////
  // State //
  ///////////

  // holds true data, must be completely replaced when mutated
  // because it might be used by react for re-drawing UI
  //
  // Class names that are not present in either of these are assumed to be
  // new, unknown classes which default to the visibility state of the
  // DEFAULT_HIDDEN_CLASSES constant. The union of these two sets should
  // match (or be a super set) of class names in the graph.
  private _visibleClasses: ReadonlySet<string> = new Set<string>();
  private _hiddenClasses: ReadonlySet<string> = new Set<string>();

  // Temporary views (Uncertain only, noteheads only); the sets above are kept.
  private _isUncertainOnly = false;
  private readonly uncertainOnlyVisibleClasses: ReadonlySet<string> = new Set([
    UNCERTAIN_CLASS_NAME,
  ]);
  private uncertainOnlyHiddenClasses: ReadonlySet<string> = new Set<string>();

  private _isNoteheadsOnly = false;
  private resumeUncertainOnlyAfterNoteheads = false;
  private noteheadsOnlyVisibleClasses: ReadonlySet<string> = new Set<string>();
  private noteheadsOnlyHiddenClasses: ReadonlySet<string> = new Set<string>();

  /**
   * Returns the set of visible class names
   */
  public get visibleClasses(): ReadonlySet<string> {
    if (this._isNoteheadsOnly) return this.noteheadsOnlyVisibleClasses;
    return this._isUncertainOnly
      ? this.uncertainOnlyVisibleClasses
      : this._visibleClasses;
  }

  /**
   * Returns the set of hidden class names
   */
  public get hiddenClasses(): ReadonlySet<string> {
    if (this._isNoteheadsOnly) return this.noteheadsOnlyHiddenClasses;
    return this._isUncertainOnly
      ? this.uncertainOnlyHiddenClasses
      : this._hiddenClasses;
  }

  /** Whether only Uncertain nodes are shown. */
  public get isUncertainOnly(): boolean {
    return this._isUncertainOnly;
  }

  public get isNoteheadsOnly(): boolean {
    return this._isNoteheadsOnly;
  }

  private getKnownClassNames(): readonly string[] {
    return [
      ...new Set([
        ...this.notationGraphStore.classNames,
        ...this._visibleClasses,
        ...this._hiddenClasses,
        UNCERTAIN_CLASS_NAME,
      ]),
    ];
  }

  private recomputeNoteheadsOnlyClasses() {
    const classes = this.getKnownClassNames();
    this.noteheadsOnlyVisibleClasses = new Set(
      classes.filter((className) => isNotehead({ className })),
    );
    this.noteheadsOnlyHiddenClasses = new Set(
      classes.filter((className) => !isNotehead({ className })),
    );
  }

  /**
   * Shows only noteheads. An active Uncertain-only view resumes when this is
   * turned off.
   */
  public setNoteheadsOnly(isEnabled: boolean) {
    if (this._isNoteheadsOnly === isEnabled) return;
    this._isNoteheadsOnly = isEnabled;
    if (isEnabled) {
      this.resumeUncertainOnlyAfterNoteheads = this._isUncertainOnly;
      this._isUncertainOnly = false;
      this.recomputeNoteheadsOnlyClasses();
    } else {
      this._isUncertainOnly = this.resumeUncertainOnlyAfterNoteheads;
      this.resumeUncertainOnlyAfterNoteheads = false;
      if (this._isUncertainOnly) this.recomputeUncertainOnlyHiddenClasses();
    }
    this.broadcastTemporaryViewChange();
  }

  private recomputeUncertainOnlyHiddenClasses() {
    this.uncertainOnlyHiddenClasses = new Set(
      this.getKnownClassNames().filter(
        (className) => className !== UNCERTAIN_CLASS_NAME,
      ),
    );
  }

  /** Shows only Uncertain nodes; the per-class visibility is kept. */
  public setUncertainOnly(isEnabled: boolean) {
    const leavesNoteheads = isEnabled && this._isNoteheadsOnly;
    this.resumeUncertainOnlyAfterNoteheads = false;
    if (this._isUncertainOnly === isEnabled && !leavesNoteheads) return;
    if (leavesNoteheads) this._isNoteheadsOnly = false;
    this._isUncertainOnly = isEnabled;
    if (isEnabled) this.recomputeUncertainOnlyHiddenClasses();
    this.broadcastTemporaryViewChange();
  }

  private exitTemporaryViewsForManualVisibilityChange() {
    if (!this._isUncertainOnly && !this._isNoteheadsOnly) return;
    this._isUncertainOnly = false;
    this._isNoteheadsOnly = false;
    this.resumeUncertainOnlyAfterNoteheads = false;
    this.broadcastTemporaryViewChange();
  }

  private broadcastTemporaryViewChange() {
    this.broadcastVisibilityChange(this.getKnownClassNames());
    this.uncertainOnlySignalAtom.signal(this.jotaiStore.set);
    this.noteheadsOnlySignalAtom.signal(this.jotaiStore.set);
  }

  /**
   * Makes sure that the given class name is present in one of the two sets.
   * If already present, does nothing. Uses the DEFAULT_HIDDEN_CLASSES to set
   * the visibility of the class.
   */
  private ensureHasClass(className: string) {
    if (
      this._visibleClasses.has(className) ||
      this._hiddenClasses.has(className)
    ) {
      return;
    }

    // modify state
    if (DEFAULT_HIDDEN_CLASSES.has(className)) {
      this._hiddenClasses = new Set<string>([
        ...this._hiddenClasses,
        className,
      ]);
    } else {
      this._visibleClasses = new Set<string>([
        ...this._visibleClasses,
        className,
      ]);
    }

    if (this._isNoteheadsOnly) this.recomputeNoteheadsOnlyClasses();
    if (this._isUncertainOnly) this.recomputeUncertainOnlyHiddenClasses();

    // broadcast change
    this._onChange.dispatch([className]);
    this.globalSignalAtom.signal(this.jotaiStore.set);
    this.classSignalAtoms.get(className).signal(this.jotaiStore.set);
  }

  /**
   * Sets visibility of a class name
   */
  public setClassVisibility(className: string, isVisible: boolean) {
    this.exitTemporaryViewsForManualVisibilityChange();
    this.setBaseClassVisibility(className, isVisible);
  }

  /** Makes a class visible without leaving a temporary view. */
  public ensureEditedClassIsVisible(className: string) {
    this.setBaseClassVisibility(className, true);
  }

  private setBaseClassVisibility(className: string, isVisible: boolean) {
    if (isVisible && this._visibleClasses.has(className)) return;
    if (!isVisible && this._hiddenClasses.has(className)) return;

    // change state
    const newVisibleClasses = new Set<string>(this._visibleClasses);
    const newHiddenClasses = new Set<string>(this._hiddenClasses);
    if (isVisible) {
      newVisibleClasses.add(className);
      newHiddenClasses.delete(className);
    } else {
      newVisibleClasses.delete(className);
      newHiddenClasses.add(className);
    }
    this._visibleClasses = newVisibleClasses;
    this._hiddenClasses = newHiddenClasses;

    if (this._isNoteheadsOnly) this.recomputeNoteheadsOnlyClasses();
    if (this._isUncertainOnly) this.recomputeUncertainOnlyHiddenClasses();

    // broadcast change
    this._onChange.dispatch([className]);
    this.globalSignalAtom.signal(this.jotaiStore.set);
    this.classSignalAtoms.get(className).signal(this.jotaiStore.set);
  }

  /**
   * Sets all classes to hidden
   */
  public hideAllClasses() {
    this.exitTemporaryViewsForManualVisibilityChange();
    // change state
    this._visibleClasses = new Set<string>([]);
    this._hiddenClasses = new Set<string>(this.notationGraphStore.classNames);

    // broadcast change
    this._onChange.dispatch(this.notationGraphStore.classNames);
    this.globalSignalAtom.signal(this.jotaiStore.set);
    for (const className of this.notationGraphStore.classNames) {
      this.classSignalAtoms.get(className).signal(this.jotaiStore.set);
    }
  }

  /**
   * Sets all classes to visible
   */
  public showAllClasses() {
    this.exitTemporaryViewsForManualVisibilityChange();
    // change state
    this._visibleClasses = new Set<string>(this.notationGraphStore.classNames);
    this._hiddenClasses = new Set<string>([]);

    // broadcast change
    this._onChange.dispatch(this.notationGraphStore.classNames);
    this.globalSignalAtom.signal(this.jotaiStore.set);
    for (const className of this.notationGraphStore.classNames) {
      this.classSignalAtoms.get(className).signal(this.jotaiStore.set);
    }
  }

  /**
   * Shows only listed classes and sets others to hidden
   */
  public showOnlyTheseClasses(classNames: Iterable<string>) {
    this.exitTemporaryViewsForManualVisibilityChange();
    // change state
    this._visibleClasses = new Set<string>(classNames);
    this._hiddenClasses = new Set<string>(
      this.notationGraphStore.classNames.filter(
        (className) => !this._visibleClasses.has(className),
      ),
    );

    // broadcast change
    this._onChange.dispatch(this.notationGraphStore.classNames);
    this.globalSignalAtom.signal(this.jotaiStore.set);
    for (const className of this.notationGraphStore.classNames) {
      this.classSignalAtoms.get(className).signal(this.jotaiStore.set);
    }
  }

  /**
   * Hides only listed classes and sets others to visible
   */
  public hideOnlyTheseClasses(classNames: Iterable<string>) {
    this.exitTemporaryViewsForManualVisibilityChange();
    // change state
    this._hiddenClasses = new Set<string>(classNames);
    this._visibleClasses = new Set<string>(
      this.notationGraphStore.classNames.filter(
        (className) => !this._hiddenClasses.has(className),
      ),
    );

    // broadcast change
    this._onChange.dispatch(this.notationGraphStore.classNames);
    this.globalSignalAtom.signal(this.jotaiStore.set);
    for (const className of this.notationGraphStore.classNames) {
      this.classSignalAtoms.get(className).signal(this.jotaiStore.set);
    }
  }

  ///////////////////////
  // React integration //
  ///////////////////////

  private readonly globalSignalAtom = new SignalAtomWrapper();
  private readonly classSignalAtoms = new SignalAtomCollection<string>();
  private readonly uncertainOnlySignalAtom = new SignalAtomWrapper();
  private readonly noteheadsOnlySignalAtom = new SignalAtomWrapper();

  public readonly isNoteheadsOnlyAtom: WritableAtom<boolean, [boolean], void> =
    atom(
      (get) => {
        this.noteheadsOnlySignalAtom.subscribe(get);
        return this._isNoteheadsOnly;
      },
      (_get, _set, newValue: boolean) => this.setNoteheadsOnly(newValue),
    );

  /**
   * Writable atom for the Uncertain-only view.
   */
  public readonly isUncertainOnlyAtom: WritableAtom<boolean, [boolean], void> =
    atom(
      (get) => {
        this.uncertainOnlySignalAtom.subscribe(get);
        return this._isUncertainOnly;
      },
      (get, set, newValue: boolean) => {
        this.setUncertainOnly(newValue);
      },
    );

  private isClassVisibleAtoms = new Map<
    string,
    WritableAtom<boolean, [boolean], void>
  >();

  /**
   * Writable atom that exposes and lets you modify the visibility
   * of a single class
   */
  public getIsClassVisibleAtom(
    className: string,
  ): WritableAtom<boolean, [boolean], void> {
    this.ensureHasClass(className);

    if (!this.isClassVisibleAtoms.has(className)) {
      this.isClassVisibleAtoms.set(
        className,
        atom(
          (get) => {
            this.classSignalAtoms.get(className).subscribe(get);
            return this.visibleClasses.has(className);
          },
          (get, set, newValue) => {
            this.setClassVisibility(className, newValue);
          },
        ),
      );
    }

    return this.isClassVisibleAtoms.get(className)!;
  }

  private broadcastVisibilityChange(classNames: readonly string[]) {
    this._onChange.dispatch(classNames);
    this.globalSignalAtom.signal(this.jotaiStore.set);
    for (const className of classNames) {
      this.classSignalAtoms.get(className).signal(this.jotaiStore.set);
    }
  }

  ////////////
  // Events //
  ////////////

  private _onChange = new SimpleEventDispatcher<readonly string[]>();

  /**
   * Fires once when the class visibility store is updated.
   * The list of affected class names is provided as the argument
   * to the event handler. To check the current visibility state
   * of a class, test its presence in one of the two exposed sets.
   */
  public get onChange(): ISimpleEvent<readonly string[]> {
    return this._onChange.asEvent();
  }
}
