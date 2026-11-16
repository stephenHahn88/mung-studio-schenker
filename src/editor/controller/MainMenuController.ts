import { atom } from "jotai";
import { IController } from "./IController";
import { NotationGraphStore } from "../model/notation-graph-store/NotationGraphStore";
import { SelectionStore } from "../model/SelectionStore";
import { JotaiStore } from "../model/JotaiStore";
import { LinkType } from "../../mung/LinkType";
import { ToolbeltController } from "./ToolbeltController";
import { EditorTool } from "../model/EditorTool";
import { PythonRuntime } from "../../../pyodide/PythonRuntime";
import { Node } from "../../mung/Node";
import { hasTimeGroupData, isNotehead } from "../../mung/TimeGroups";
import { ClassVisibilityStore } from "../model/ClassVisibilityStore";
import { EditorStateStore } from "../model/EditorStateStore";
import { ZoomController } from "./ZoomController";
import { BackgroundImageStore } from "../model/BackgroundImageStore";
import { TimeGroupStore } from "../model/TimeGroupStore";
import { ModelApi, ModelNode, PageRegion, SymbolPrediction } from "./ModelApi";
import { HistoryStore } from "../model/HistoryStore";
import { isMacish } from "../../utils/isMacish";
import { MUNG_CLASSES_BY_NAME } from "../../mung/ontology/mungClasses";
import {
  RELATION_INFERENCE_ENABLED,
  RELATION_INFERENCE_UNAVAILABLE_MESSAGE,
  SYMBOL_INFERENCE_ENABLED,
  SYMBOL_INFERENCE_UNAVAILABLE_MESSAGE,
} from "../../utils/featureFlags";

/** The model actions that can run on a whole page or on a selected region. */
export type ModelAction =
  | "symbols"
  | "syntaxLinks"
  | "timeGroups"
  | "precedence";

export const MODEL_ACTION_LABELS: Record<ModelAction, string> = {
  symbols: "symbol detection",
  syntaxLinks: "syntax-link prediction",
  timeGroups: "time-group prediction",
  precedence: "precedence-link prediction",
};

export interface ModelRunOptions {
  /** Detector score threshold; null uses the backend default. */
  readonly scoreThreshold?: number | null;
}

/**
 * Throws when a model response refers to a different page size than the
 * annotation canvas, so predictions are never inserted in wrong coordinates.
 */
export function assertDetectionImageSize(
  actual: { readonly width: number; readonly height: number },
  expected: { readonly width: number; readonly height: number },
  label: string,
): void {
  if (
    !Number.isInteger(expected.width) ||
    !Number.isInteger(expected.height) ||
    expected.width <= 0 ||
    expected.height <= 0 ||
    actual?.width !== expected.width ||
    actual?.height !== expected.height
  ) {
    throw new Error(
      `${label} dimensions do not match the annotation page (${expected.width} × ${expected.height}). No predictions were applied.`,
    );
  }
}

/**
 * Implements the logic and keyboard shortcuts behind actions from
 * the main menu, including the model actions. This controller is always
 * enabled.
 */
export class MainMenuController implements IController {
  public readonly controllerName = "MainMenuController";
  private static readonly REGION_REPLACE_MIN_COVERAGE = 0.5;

  private readonly jotaiStore: JotaiStore;

  private readonly notationGraphStore: NotationGraphStore;
  private readonly selectionStore: SelectionStore;
  private readonly zoomController: ZoomController;
  private readonly toolbeltController: ToolbeltController;
  private readonly editorStateStore: EditorStateStore;
  private readonly pythonRuntime: PythonRuntime;
  private readonly classVisibilityStore: ClassVisibilityStore;
  private readonly backgroundImageStore: BackgroundImageStore;
  private readonly historyStore: HistoryStore;
  private readonly timeGroupStore: TimeGroupStore | null;

  constructor(
    jotaiStore: JotaiStore,
    notationGraphStore: NotationGraphStore,
    selectionStore: SelectionStore,
    zoomController: ZoomController,
    toolbeltController: ToolbeltController,
    editorStateStore: EditorStateStore,
    pythonRuntime: PythonRuntime,
    classVisibilityStore: ClassVisibilityStore,
    backgroundImageStore: BackgroundImageStore,
    historyStore: HistoryStore,
    timeGroupStore: TimeGroupStore | null = null,
  ) {
    this.jotaiStore = jotaiStore;
    this.notationGraphStore = notationGraphStore;
    this.selectionStore = selectionStore;
    this.zoomController = zoomController;
    this.toolbeltController = toolbeltController;
    this.editorStateStore = editorStateStore;
    this.pythonRuntime = pythonRuntime;
    this.classVisibilityStore = classVisibilityStore;
    this.backgroundImageStore = backgroundImageStore;
    this.historyStore = historyStore;
    this.timeGroupStore = timeGroupStore;
  }

  public readonly isEnabledAtom = atom(true);
  public readonly isEnabled = true;

  //////////////////
  // Key bindings //
  //////////////////

  public readonly keyBindings = {
    Delete: () => {
      this.removeSelectedNodes();
    },
    F: () => {
      if (this.toolbeltController.currentTool === EditorTool.NodeEditing) {
        return; // in node-editing, "F" means "fill"
      }
      this.zoomToSelectedNode();
    },
    E: () => {
      this.toggleSyntaxLink();
    },
    Q: () => {
      this.togglePrecedenceLink();
    },
    "Shift+Delete": () => {
      this.removePartiallySelectedLinks();
    },
    "Shift+S": () => {
      this.generateGraphFromStafflines();
    },
    "Shift+N": () => {
      this.snapNodesToStaves();
    },
    Escape: () => {
      this.clearSelection();
    },
  };

  public onKeyDown(e: KeyboardEvent): void {
    if (this.isTextInputEvent(e)) return;

    const isModifierPressed = isMacish() ? e.metaKey : e.ctrlKey;
    if (!isModifierPressed) return;

    const key = e.key.toLowerCase();
    if (key === "z" && e.shiftKey) {
      e.preventDefault();
      this.redo();
      return;
    }
    if (key === "z") {
      e.preventDefault();
      this.undo();
      return;
    }
    if (key === "y") {
      e.preventDefault();
      this.redo();
      return;
    }
    if (key === "u") {
      e.preventDefault();
      this.switchSelectedUpDown("Up");
      return;
    }
    if (key === "d") {
      e.preventDefault();
      this.switchSelectedUpDown("Down");
      return;
    }
    if (key === "c") {
      e.preventDefault();
      this.copySelectedNodes();
      return;
    }
    if (key === "v") {
      e.preventDefault();
      this.pasteNodes();
      return;
    }
  }

  /**
   * Switch the selected node(s) to their "Up" or "Down" sibling class — e.g.
   * slurStructuralDown <-> slurStructuralUp. Generic: flips a trailing
   * "Up"/"Down" in the class name, applied only when the resulting class
   * actually exists (so it covers slur/beam/flag/grace/voiceExchange/etc.
   * families and is a no-op on classes without an Up/Down sibling).
   * Bound to Ctrl/Cmd+U (Up) and Ctrl/Cmd+D (Down).
   */
  private switchSelectedUpDown(direction: "Up" | "Down"): void {
    for (const id of this.selectionStore.selectedNodeIds) {
      if (!this.notationGraphStore.hasNode(id)) continue;
      const node = this.notationGraphStore.getNode(id);
      const target = this.upDownVariant(node.className, direction);
      if (target !== null && target !== node.className) {
        this.notationGraphStore.updateNode({ ...node, className: target });
      }
    }
  }

  private upDownVariant(
    className: string,
    direction: "Up" | "Down",
  ): string | null {
    let candidate: string | null = null;
    if (direction === "Up") {
      if (className.endsWith("Down")) candidate = className.slice(0, -4) + "Up";
    } else {
      if (className.endsWith("Up")) candidate = className.slice(0, -2) + "Down";
    }
    if (candidate === null) return null;
    return MUNG_CLASSES_BY_NAME[candidate] !== undefined ? candidate : null;
  }

  // Internal clipboard for copy/paste of annotation boxes.
  private clipboardNodes: Node[] = [];

  /** Ctrl/Cmd+C: copy the selected node(s) into the clipboard. */
  private copySelectedNodes(): void {
    const copied: Node[] = [];
    for (const id of this.selectionStore.selectedNodeIds) {
      if (this.notationGraphStore.hasNode(id)) {
        copied.push(this.notationGraphStore.getNode(id));
      }
    }
    this.clipboardNodes = copied;
    if (copied.length > 0) {
      this.setModelStatus(
        `Copied ${copied.length} symbol(s). Press Ctrl+V to paste.`,
      );
    }
  }

  /**
   * Ctrl/Cmd+V: paste copies of the clipboard node(s). Each copy keeps the
   * class and box, gets a fresh id, is offset slightly so it is visible, and is
   * selected in the pointer tool so it can be dragged/resized immediately.
   * Handy for many similar symbols in nearby places: copy once, paste, drag.
   */
  private pasteNodes(): void {
    if (this.clipboardNodes.length === 0) return;
    const OFFSET = 15;
    const newIds: number[] = [];
    for (const src of this.clipboardNodes) {
      const mask = src.decodedMask;
      const node: Node = {
        id: this.notationGraphStore.getFreeId(),
        className: src.className,
        left: src.left + OFFSET,
        top: src.top + OFFSET,
        width: src.width,
        height: src.height,
        syntaxOutlinks: [],
        syntaxInlinks: [],
        precedenceOutlinks: [],
        precedenceInlinks: [],
        decodedMask:
          mask === null
            ? null
            : new ImageData(
                new Uint8ClampedArray(mask.data),
                mask.width,
                mask.height,
              ),
        textTranscription: src.textTranscription,
        data: {},
        polygon: null,
      };
      this.notationGraphStore.insertNode(node);
      newIds.push(node.id);
    }
    this.toolbeltController.setCurrentTool(EditorTool.Pointer);
    this.selectionStore.changeSelection(newIds);
    this.setModelStatus(
      `Pasted ${newIds.length} symbol(s). Drag to reposition or resize.`,
    );
  }

  /** Live count of ALL syntax edges in the document (works across reloads). */
  public readonly syntaxEdgeCountAtom = atom((get) => {
    return get(this.notationGraphStore.syntaxLinksAtom).length;
  });

  /**
   * Removes ALL syntax edges from the document (predicted and hand-drawn
   * alike), leaving every symbol untouched.
   */
  public clearAllEdges(): void {
    const links = [...this.notationGraphStore.syntaxLinks];
    for (const link of links) {
      this.notationGraphStore.removeLink(link.fromId, link.toId, link.type);
    }
    this.setModelStatus(
      links.length === 0
        ? "No edges to clear."
        : `Removed ${links.length} edge(s); symbols untouched.`,
    );
  }

  private isTextInputEvent(e: KeyboardEvent): boolean {
    if (!(e.target instanceof HTMLElement)) return false;
    return (
      e.target.closest("input, textarea, [contenteditable='true']") !== null
    );
  }

  //////////////////////////
  // Action preconditions //
  //////////////////////////

  public canRemoveNodesAtom = atom(
    (get) =>
      get(this.selectionStore.selectedNodeIdsAtom).length > 0 &&
      get(this.toolbeltController.currentToolAtom) !== EditorTool.NodeEditing &&
      get(this.toolbeltController.currentToolAtom) !==
        EditorTool.RecognitionRegion,
  );

  public canZoomToSelectedNodeAtom = atom(
    (get) => get(this.selectionStore.selectedNodeIdsAtom).length == 1,
  );

  public canRemoveLinksAtom = atom(
    (get) => get(this.selectionStore.selectedNodeIdsAtom).length > 0,
  );

  public canToggleLinkAtom = atom(
    (get) => get(this.selectionStore.selectedNodeIdsAtom).length == 2,
  );

  public canClearSelectionAtom = atom(
    (get) =>
      get(this.selectionStore.selectedNodeIdsAtom).length > 0 &&
      get(this.toolbeltController.currentToolAtom) !== EditorTool.NodeEditing &&
      get(this.toolbeltController.currentToolAtom) !==
        EditorTool.RecognitionRegion,
  );

  public canGenerateGraphFromStafflinesAtom = atom((get) => {
    const nodes = get(this.selectionStore.selectedNodesAtom);
    if (nodes.length !== 5) {
      return false;
    }
    for (const node of nodes) {
      if (node.className !== "staffLine") {
        return false;
      }
    }
    return true;
  });

  public canUndoAtom = atom((get) => get(this.historyStore.canUndoAtom));
  public canRedoAtom = atom((get) => get(this.historyStore.canRedoAtom));

  ////////////////////////////
  // Action implementations //
  ////////////////////////////

  public removeSelectedNodes(): void {
    if (!this.jotaiStore.get(this.canRemoveNodesAtom)) return;
    for (const nodeId of this.selectionStore.selectedNodeIds) {
      this.notationGraphStore.removeNodeWithLinks(nodeId);
    }
  }

  public zoomToSelectedNode(): void {
    if (!this.jotaiStore.get(this.canZoomToSelectedNodeAtom)) return;
    const node = this.notationGraphStore.getNode(
      this.selectionStore.selectedNodeIds[0],
    );
    this.zoomController.zoomToNode(node);
  }

  public toggleSyntaxLink(): void {
    if (!this.jotaiStore.get(this.canToggleLinkAtom)) return;
    const fromId = this.selectionStore.selectedNodeIds[0];
    const toId = this.selectionStore.selectedNodeIds[1];
    this.notationGraphStore.toggleLink(fromId, toId, LinkType.Syntax);
  }

  public togglePrecedenceLink(): void {
    if (!this.jotaiStore.get(this.canToggleLinkAtom)) return;
    const fromId = this.selectionStore.selectedNodeIds[0];
    const toId = this.selectionStore.selectedNodeIds[1];
    this.notationGraphStore.toggleLink(fromId, toId, LinkType.Precedence);
  }

  public removePartiallySelectedLinks(): void {
    if (!this.jotaiStore.get(this.canRemoveLinksAtom)) return;

    const canRemoveSyntaxLinks =
      this.editorStateStore.isDisplaySyntaxLinks &&
      this.toolbeltController.currentTool !== EditorTool.PrecedenceLinks;
    const canRemovePrecedenceLinks =
      this.editorStateStore.isDisplayPrecedenceLinks &&
      this.toolbeltController.currentTool !== EditorTool.SyntaxLinks;

    const links = this.selectionStore.partiallySelectedLinks;
    for (const link of links) {
      if (link.type === LinkType.Syntax && !canRemoveSyntaxLinks) continue;
      if (link.type === LinkType.Precedence && !canRemovePrecedenceLinks)
        continue;
      this.notationGraphStore.removeLink(link.fromId, link.toId, link.type);
    }
  }

  public clearSelection(): void {
    if (!this.jotaiStore.get(this.canClearSelectionAtom)) return;
    this.selectionStore.clearSelection();
  }

  public undo(): void {
    if (!this.historyStore.undo()) return;
    this.selectionStore.clearSelection();
  }

  public redo(): void {
    if (!this.historyStore.redo()) return;
    this.selectionStore.clearSelection();
  }

  public async generateGraphFromStafflines(): Promise<void> {
    if (!this.jotaiStore.get(this.canGenerateGraphFromStafflinesAtom)) return;

    const api = this.pythonRuntime.maskManipulation;

    // get the stafflines
    // (and remove all syntax from stafflines as to not interfere with python)
    const staffLines = this.jotaiStore
      .get(this.selectionStore.selectedNodesAtom)
      .map((s) => ({
        ...s,
        syntaxInlinks: [],
        syntaxOutlinks: [],
      }));

    // create the staff object
    console.log("Generating the staff...");
    const proposedStaff = await api.generateStaffFromStafflines(staffLines);
    const staff: Node = {
      id: this.notationGraphStore.getFreeId(),
      className: "staff",
      top: proposedStaff.top,
      left: proposedStaff.left,
      width: proposedStaff.width,
      height: proposedStaff.height,
      syntaxInlinks: [],
      syntaxOutlinks: [],
      precedenceInlinks: [],
      precedenceOutlinks: [],
      decodedMask: proposedStaff.decodedMask,
      textTranscription: null,
      data: {},
      polygon: null,
    };
    this.notationGraphStore.insertNode(staff);

    // add syntax links from the new staff to all stafflines
    for (const line of staffLines) {
      this.notationGraphStore.insertLink(staff.id, line.id, LinkType.Syntax);
    }

    // create the staffspace objects and link them from the staff
    console.log("Generating staff spaces...");
    const proposedStaffspaces = await api.generateStaffspaces(
      [...staffLines.map((s) => s.id), staff.id].map((id) =>
        this.notationGraphStore.getNode(id),
      ),
    );
    const staffSpaces: Node[] = [];
    for (const proposedStaffspace of proposedStaffspaces) {
      const staffSpace: Node = {
        id: this.notationGraphStore.getFreeId(),
        className: "staffSpace",
        top: proposedStaffspace.top,
        left: proposedStaffspace.left,
        width: proposedStaffspace.width,
        height: proposedStaffspace.height,
        syntaxInlinks: [],
        syntaxOutlinks: [],
        precedenceInlinks: [],
        precedenceOutlinks: [],
        decodedMask: proposedStaffspace.decodedMask,
        textTranscription: null,
        data: {},
        polygon: null,
      };
      staffSpaces.push(staffSpace);
      this.notationGraphStore.insertNode(staffSpace);
      this.notationGraphStore.insertLink(
        staff.id,
        staffSpace.id,
        LinkType.Syntax,
      );
    }

    // make sure the new objects are visible
    this.classVisibilityStore.setClassVisibility("staff", true);
    this.classVisibilityStore.setClassVisibility("staffSpace", true);

    // select the new nodes
    this.selectionStore.changeSelection([
      staff.id,
      ...staffSpaces.map((n) => n.id),
    ]);

    console.log("DONE!");
  }

  public async snapNodesToStaves(): Promise<void> {
    const api = this.pythonRuntime.maskManipulation;

    // process the entire graph and get the processed copy
    console.log("Running object snapping...");
    const snappedGraph = await api.snapNodesToStaves(
      this.notationGraphStore.nodes,
    );

    console.log(snappedGraph);

    // extract all staves, stafflines, and staff spaces
    const interestingInNodeClasses = ["staff", "staffLine", "staffSpace"];
    const interestingInNodes = snappedGraph.filter((n) =>
      interestingInNodeClasses.includes(n.className),
    );

    // reconstruct created links in our document
    for (const inNode of interestingInNodes) {
      for (const inlink of inNode.syntaxInlinks) {
        const hasLink = this.notationGraphStore.hasLink(
          inlink,
          inNode.id,
          LinkType.Syntax,
        );
        if (!hasLink) {
          this.notationGraphStore.insertLink(
            inlink,
            inNode.id,
            LinkType.Syntax,
          );
        }
      }
    }

    console.log("DONE!");
  }

  ///////////////////
  // Model actions //
  ///////////////////

  private readonly isModelRunningBaseAtom = atom<boolean>(false);

  public readonly isModelRunningAtom = atom((get) =>
    get(this.isModelRunningBaseAtom),
  );

  private readonly modelStatusBaseAtom = atom<string | null>(null);

  public readonly modelStatusAtom = atom((get) =>
    get(this.modelStatusBaseAtom),
  );

  public setModelStatus(message: string | null): void {
    this.jotaiStore.set(this.modelStatusBaseAtom, message);
  }

  public readonly canRunModelsAtom = atom(
    (get) =>
      this.backgroundImageStore.imageUrl !== null &&
      !get(this.isModelRunningBaseAtom),
  );

  public readonly canClearPredictedSymbolsAtom = atom((get) => {
    get(this.notationGraphStore.nodeIdsAtom);
    return this.countPredictedSymbolNodes() > 0;
  });

  public readonly predictedSymbolCountAtom = atom((get) => {
    get(this.notationGraphStore.nodeIdsAtom);
    return this.countPredictedSymbolNodes();
  });

  /**
   * Runs one model action on the whole page (region = null) or on the nodes
   * and pixels inside a region of the page.
   *
   * - symbols: replaces earlier symbol predictions in the page or region and
   *   inserts the new detections as nodes tagged with their model.
   * - syntaxLinks / precedence: sends the current nodes and adds the
   *   predicted links between nodes that are not linked yet (in either
   *   direction), as one undoable edit.
   * - timeGroups: sends the current nodes and creates predicted time groups
   *   for noteheads that are not grouped yet.
   */
  public async runModel(
    action: ModelAction,
    documentName: string,
    region: DOMRect | null = null,
    options: ModelRunOptions = {},
  ): Promise<void> {
    if (
      action === "symbols"
        ? this.notifyInferenceUnavailable(
            SYMBOL_INFERENCE_ENABLED,
            SYMBOL_INFERENCE_UNAVAILABLE_MESSAGE,
          )
        : this.notifyInferenceUnavailable(
            RELATION_INFERENCE_ENABLED,
            RELATION_INFERENCE_UNAVAILABLE_MESSAGE,
          )
    ) {
      return;
    }
    if (!documentName) {
      this.setModelStatus("No document is open.");
      return;
    }
    if (!this.jotaiStore.get(this.canRunModelsAtom)) return;

    let clipped: DOMRect | null = null;
    if (region !== null) {
      clipped = this.clipRegionToPage(region);
      if (clipped === null) {
        const message =
          "The selected area does not overlap the page. No predictions were applied.";
        this.setModelStatus(message);
        window.alert(message);
        return;
      }
    }

    if (action === "symbols") {
      await this.detectSymbols(
        documentName,
        clipped,
        options.scoreThreshold ?? null,
      );
    } else if (action === "timeGroups") {
      await this.predictTimeGroups(documentName, clipped);
    } else {
      await this.predictLinks(action, documentName, clipped);
    }
  }

  private async detectSymbols(
    documentName: string,
    region: DOMRect | null,
    scoreThreshold: number | null,
  ): Promise<void> {
    if (this.protectTimeGroupsFromRecognition(region)) return;
    this.jotaiStore.set(this.isModelRunningBaseAtom, true);
    this.setModelStatus(
      "Running symbol detection" +
        (region === null ? "" : " in the selected area") +
        "...",
    );
    try {
      const api = new ModelApi();
      const result = await api.detectSymbols(
        documentName,
        region === null ? null : this.toPageRegion(region),
        scoreThreshold,
      );
      assertDetectionImageSize(
        result.image,
        this.pageSize(),
        "Detection result",
      );
      // A collaborator can annotate while the model request is in flight.
      // Re-check immediately before the synchronous replacement.
      if (this.protectTimeGroupsFromRecognition(region)) return;
      const removed = this.removePredictedSymbolNodes(region);
      const inserted = this.insertSymbolPredictions(
        result.predictions,
        result.model,
      );
      const message =
        `Inserted ${inserted} symbols` +
        (region === null ? "" : " in the selected area") +
        (removed > 0 ? ` · replaced ${removed} earlier predictions` : "") +
        ".";
      this.setModelStatus(message);
      window.alert(message);
    } catch (e) {
      const message = String(e);
      console.error(e);
      this.setModelStatus(message);
      window.alert(message);
    } finally {
      this.jotaiStore.set(this.isModelRunningBaseAtom, false);
    }
  }

  private async predictLinks(
    action: "syntaxLinks" | "precedence",
    documentName: string,
    region: DOMRect | null,
  ): Promise<void> {
    const nodes = this.nodesForModel(region);
    if (nodes.length < 2) {
      this.setModelStatus(
        "At least two symbols are needed" +
          (region === null ? "" : " in the selected area") +
          " to predict links.",
      );
      return;
    }
    const linkType =
      action === "syntaxLinks" ? LinkType.Syntax : LinkType.Precedence;
    const label = action === "syntaxLinks" ? "syntax" : "precedence";
    const submitted = this.graphSignature(nodes);
    this.jotaiStore.set(this.isModelRunningBaseAtom, true);
    this.setModelStatus(`Predicting ${label} links...`);
    try {
      const api = new ModelApi();
      const result =
        action === "syntaxLinks"
          ? await api.predictSyntaxLinks(documentName, nodes)
          : await api.predictPrecedence(documentName, nodes);
      if (this.graphSignature(nodes) !== submitted) {
        throw new Error(
          "The symbols changed during prediction. No links were added; please run again.",
        );
      }
      const allowed = new Set(nodes.map((node) => node.id));
      let added = 0;
      for (const link of result.links) {
        // A pair that is already linked (in either direction) keeps its link.
        if (
          link.source === link.target ||
          !allowed.has(link.source) ||
          !allowed.has(link.target) ||
          this.notationGraphStore.hasLink(link.source, link.target, linkType) ||
          this.notationGraphStore.hasLink(link.target, link.source, linkType)
        ) {
          continue;
        }
        this.notationGraphStore.insertLink(link.source, link.target, linkType);
        added++;
      }
      this.setModelStatus(
        `Added ${added} predicted ${label} link(s) from ` +
          `${result.links.length} predictions` +
          (region === null ? "" : " in the selected area") +
          ".",
      );
    } catch (e) {
      console.error(e);
      this.setModelStatus(`The ${label}-link prediction failed: ` + String(e));
    } finally {
      this.jotaiStore.set(this.isModelRunningBaseAtom, false);
    }
  }

  private async predictTimeGroups(
    documentName: string,
    region: DOMRect | null,
  ): Promise<void> {
    if (this.timeGroupStore === null) {
      this.setModelStatus("Time groups are not available in this editor.");
      return;
    }
    const nodes = this.nodesForModel(region);
    if (!nodes.some((node) => isNotehead(node))) {
      this.setModelStatus(
        "No noteheads" +
          (region === null ? "" : " in the selected area") +
          " to group.",
      );
      return;
    }
    const submitted = this.graphSignature(nodes);
    this.jotaiStore.set(this.isModelRunningBaseAtom, true);
    this.setModelStatus("Predicting time groups...");
    try {
      const api = new ModelApi();
      const result = await api.predictTimeGroups(documentName, nodes);
      if (this.graphSignature(nodes) !== submitted) {
        throw new Error(
          "The symbols changed during prediction. No groups were added; please run again.",
        );
      }
      const allowed = new Set(nodes.map((node) => node.id));
      const summary = this.timeGroupStore.addPredictedGroups(
        result.groups.map((group) => group.filter((id) => allowed.has(id))),
      );
      this.setModelStatus(
        `Created ${summary.createdGroups} predicted time group(s) from ` +
          `${result.groups.length} predictions` +
          (summary.skippedNoteheads > 0
            ? `; ${summary.skippedNoteheads} already grouped notehead(s) were left unchanged`
            : "") +
          ".",
      );
    } catch (e) {
      console.error(e);
      this.setModelStatus("The time-group prediction failed: " + String(e));
    } finally {
      this.jotaiStore.set(this.isModelRunningBaseAtom, false);
    }
  }

  public clearPredictedSymbols(): void {
    if (this.protectTimeGroupsFromRecognition(null)) return;
    const removedCount = this.removePredictedSymbolNodes(null);

    if (removedCount === 0) {
      this.setModelStatus("No predicted symbols to clear.");
      return;
    }

    this.selectionStore.clearSelection();
    this.setModelStatus(`Removed ${removedCount} predicted symbols.`);
  }

  /** Replacement and clearing remove predicted nodes; grouped ones are kept. */
  private protectTimeGroupsFromRecognition(region: DOMRect | null): boolean {
    const protectedNodes = this.notationGraphStore.nodes.filter(
      (node) =>
        this.isPredictedSymbolNode(node) &&
        hasTimeGroupData(node) &&
        (region === null || this.nodeBelongsToRegion(node, region)),
    );
    if (protectedNodes.length === 0) return false;
    const message =
      `Symbol detection left the document unchanged: ${protectedNodes.length} ` +
      `predicted symbol(s) have time-group annotations. ` +
      `Run detection in an ungrouped area, or remove the affected group ` +
      `memberships before replacing or clearing those symbols.`;
    this.setModelStatus(message);
    window.alert(message);
    return true;
  }

  /**
   * Prevents requests for a model family that is disabled in this build.
   * Returns true when the caller must stop.
   */
  private notifyInferenceUnavailable(
    enabled: boolean,
    unavailableMessage: string,
  ): boolean {
    if (enabled) return false;
    this.setModelStatus(unavailableMessage);
    window.alert(unavailableMessage);
    return true;
  }

  private removePredictedSymbolNodes(region: DOMRect | null): number {
    const predictionNodeIds = this.notationGraphStore.nodes
      .filter(
        (node) =>
          this.isPredictedSymbolNode(node) &&
          (region === null || this.nodeBelongsToRegion(node, region)),
      )
      .map((node) => node.id);

    for (const nodeId of predictionNodeIds) {
      if (this.notationGraphStore.hasNode(nodeId)) {
        this.notationGraphStore.removeNodeWithLinks(nodeId);
      }
    }

    return predictionNodeIds.length;
  }

  private insertSymbolPredictions(
    predictions: readonly SymbolPrediction[],
    modelKey: string,
  ): number {
    const insertedNodeIds: number[] = [];

    for (const prediction of predictions) {
      const data: Node["data"] = {
        symbol_detector_prediction: { type: "str", value: "true" },
        symbol_detector_model_key: { type: "str", value: modelKey },
      };
      if (
        typeof prediction.confidence === "number" &&
        Number.isFinite(prediction.confidence)
      ) {
        data["symbol_detector_confidence"] = {
          type: "float",
          value: prediction.confidence.toFixed(6),
        };
      }
      const node: Node = {
        id: this.notationGraphStore.getFreeId(),
        className: prediction.className,
        top: Math.round(prediction.top),
        left: Math.round(prediction.left),
        width: Math.max(1, Math.round(prediction.width)),
        height: Math.max(1, Math.round(prediction.height)),
        syntaxInlinks: [],
        syntaxOutlinks: [],
        precedenceInlinks: [],
        precedenceOutlinks: [],
        decodedMask: null,
        textTranscription: null,
        data,
        polygon: null,
      };

      this.notationGraphStore.insertNode(node);
      this.classVisibilityStore.setClassVisibility(node.className, true);
      insertedNodeIds.push(node.id);
    }

    if (insertedNodeIds.length > 0) {
      this.selectionStore.changeSelection(insertedNodeIds);
    }

    return insertedNodeIds.length;
  }

  private countPredictedSymbolNodes(): number {
    return this.notationGraphStore.nodes.filter((node) =>
      this.isPredictedSymbolNode(node),
    ).length;
  }

  /**
   * Nodes inserted by the symbol detector carry the DataItem
   * symbol_detector_prediction = "true". Pages annotated with earlier
   * versions of the tool may carry yolo26_combined = "true" instead.
   */
  private isPredictedSymbolNode(node: Node): boolean {
    return (
      node.data["symbol_detector_prediction"]?.value === "true" ||
      node.data["yolo26_combined"]?.value === "true"
    );
  }

  /** The nodes sent to a relation model: the whole page or one region. */
  private nodesForModel(region: DOMRect | null): ModelNode[] {
    return this.notationGraphStore.nodes
      .filter(
        (node) =>
          node.width > 0 &&
          node.height > 0 &&
          (region === null || this.nodeBelongsToRegion(node, region)),
      )
      .map((node) => ({
        id: node.id,
        className: node.className,
        left: node.left,
        top: node.top,
        width: node.width,
        height: node.height,
      }));
  }

  private graphSignature(nodes: readonly ModelNode[]): string {
    return JSON.stringify(
      nodes.map((node) => {
        if (!this.notationGraphStore.hasNode(node.id)) return [node.id];
        const current = this.notationGraphStore.getNode(node.id);
        return [
          current.id,
          current.className,
          current.left,
          current.top,
          current.width,
          current.height,
        ];
      }),
    );
  }

  private pageSize(): { width: number; height: number } {
    return {
      width: this.jotaiStore.get(this.backgroundImageStore.widthAtom),
      height: this.jotaiStore.get(this.backgroundImageStore.heightAtom),
    };
  }

  /** Intersect a region with the page; null when they do not overlap. */
  private clipRegionToPage(region: DOMRect): DOMRect | null {
    const page = this.pageSize();
    const left = Math.max(0, Math.floor(region.left));
    const top = Math.max(0, Math.floor(region.top));
    const right = Math.min(page.width, Math.ceil(region.right));
    const bottom = Math.min(page.height, Math.ceil(region.bottom));
    if (right <= left || bottom <= top) return null;
    return new DOMRect(left, top, right - left, bottom - top);
  }

  private toPageRegion(region: DOMRect): PageRegion {
    return {
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
    };
  }

  /** A node belongs to a region when at least half of its box lies inside. */
  private nodeBelongsToRegion(
    node: Pick<Node, "left" | "top" | "width" | "height">,
    region: DOMRect,
  ): boolean {
    const nodeArea = node.width * node.height;
    if (nodeArea <= 0) {
      return false;
    }
    const left = Math.max(node.left, region.left);
    const top = Math.max(node.top, region.top);
    const right = Math.min(node.left + node.width, region.right);
    const bottom = Math.min(node.top + node.height, region.bottom);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    return (
      intersection / nodeArea >= MainMenuController.REGION_REPLACE_MIN_COVERAGE
    );
  }
}
