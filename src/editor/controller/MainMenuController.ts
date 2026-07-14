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
import { ClassVisibilityStore } from "../model/ClassVisibilityStore";
import { EditorStateStore } from "../model/EditorStateStore";
import { ZoomController } from "./ZoomController";
import { BackgroundImageStore } from "../model/BackgroundImageStore";
import {
  DEFAULT_LARGE_DETECTION_MODEL_KEY,
  DEFAULT_SMALL_DETECTION_MODEL_KEY,
  DEFAULT_YOLO26_DETECTION_OPTIONS,
  SymbolDetectionRunOptions,
  SymbolDetectionSource,
  Yolo26DetectionApi,
  Yolo26DetectionOptions,
  Yolo26Prediction,
} from "./Yolo26DetectionApi";
import { HistoryStore } from "../model/HistoryStore";
import { isMacish } from "../../utils/isMacish";
import { MUNG_CLASSES_BY_NAME } from "../../mung/ontology/mungClasses";

/**
 * Implements the logic and keyboard shortcuts behind actions from
 * the main menu. This controller is always enabled.
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
      this.setYolo26Status(
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
    this.setYolo26Status(
      `Pasted ${newIds.length} symbol(s). Drag to reposition or resize.`,
    );
  }

  /**
   * Predict syntax edges among ALL symbols using the server-side edge model,
   * and add the returned links to the graph. Predicts on the document's
   * last-saved mung.xml, so save (autosave) before running.
   */
  public async predictEdges(
    documentName: string,
    threshold?: number,
  ): Promise<void> {
    if (!documentName) {
      this.setYolo26Status("No document name for edge prediction.");
      return;
    }
    const api = new Yolo26DetectionApi();
    this.setYolo26Status("Predicting edges...");
    try {
      const result = await api.assembleEdges(documentName, threshold);
      let added = 0;
      for (const e of result.edges) {
        if (
          !this.notationGraphStore.hasNode(e.source) ||
          !this.notationGraphStore.hasNode(e.target)
        ) {
          continue;
        }
        const src = this.notationGraphStore.getNode(e.source);
        if (
          src.syntaxOutlinks.includes(e.target) ||
          src.syntaxInlinks.includes(e.target)
        ) {
          continue; // already linked
        }
        this.notationGraphStore.insertLink(e.source, e.target, LinkType.Syntax);
        added++;
      }
      this.setYolo26Status(
        `Added ${added} predicted edge(s) from ${result.edges.length} candidates` +
          (threshold !== undefined ? ` (threshold ${threshold})` : "") +
          ((result.skippedInvalidNodeCount ?? 0) > 0
            ? `; skipped ${result.skippedInvalidNodeCount} unclassified symbol(s)`
            : "") +
          ".",
      );
    } catch (err) {
      this.setYolo26Status("Edge prediction failed: " + String(err));
    }
  }

  /** Live count of ALL syntax edges in the document (works across reloads). */
  public readonly syntaxEdgeCountAtom = atom((get) => {
    return get(this.notationGraphStore.syntaxLinksAtom).length;
  });

  /**
   * Removes ALL syntax edges from the document (predicted and hand-drawn
   * alike), leaving every symbol untouched. Unlike the old session-scoped
   * "clear predicted edges", this works after a reload too.
   */
  public clearAllEdges(): void {
    const links = [...this.notationGraphStore.syntaxLinks];
    for (const link of links) {
      this.notationGraphStore.removeLink(link.fromId, link.toId, link.type);
    }
    this.setYolo26Status(
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

  private readonly isYolo26RunningBaseAtom = atom<boolean>(false);

  public readonly isYolo26RunningAtom = atom((get) =>
    get(this.isYolo26RunningBaseAtom),
  );

  private readonly yolo26StatusBaseAtom = atom<string | null>(null);

  public readonly yolo26StatusAtom = atom((get) =>
    get(this.yolo26StatusBaseAtom),
  );

  public setYolo26Status(message: string | null): void {
    this.jotaiStore.set(this.yolo26StatusBaseAtom, message);
  }

  public canRunYolo26CombinedAtom = atom(
    (get) =>
      Yolo26DetectionApi.isConfigured() &&
      this.backgroundImageStore.imageUrl !== null &&
      !get(this.isYolo26RunningBaseAtom),
  );

  public canClearYolo26PredictionsAtom = atom((get) => {
    get(this.notationGraphStore.nodeIdsAtom);
    return this.countYolo26PredictionNodes() > 0;
  });

  public readonly yolo26PredictionCountAtom = atom((get) => {
    get(this.notationGraphStore.nodeIdsAtom);
    return this.countYolo26PredictionNodes();
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
      this.jotaiStore.get(this.editorStateStore.displaySyntaxLinksAtom) &&
      this.toolbeltController.currentTool !== EditorTool.PrecedenceLinks;
    const canRemovePrecedenceLinks =
      this.jotaiStore.get(this.editorStateStore.displayPrecedenceLinksAtom) &&
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

  public async runYolo26Combined(
    options?: SymbolDetectionRunOptions,
  ): Promise<void> {
    if (!this.jotaiStore.get(this.canRunYolo26CombinedAtom)) return;
    if (this.backgroundImageStore.imageUrl === null) return;
    const runOptions = {
      ...(options ?? this.buildDefaultSymbolDetectionRunOptions()),
      deduplicate: true,
    };
    const region = this.getRecognitionRegion(runOptions);
    const sourcesToReplace = this.getRunSources(runOptions);
    if (sourcesToReplace.length === 0) {
      this.jotaiStore.set(
        this.yolo26StatusBaseAtom,
        "Choose at least one prediction source.",
      );
      return;
    }

    this.jotaiStore.set(this.isYolo26RunningBaseAtom, true);
    this.jotaiStore.set(
      this.yolo26StatusBaseAtom,
      `Running ${this.formatSources(sourcesToReplace)} detection${
        region === null ? "" : " in the selected area"
      }...`,
    );

    try {
      const api = new Yolo26DetectionApi();
      const result = await api.detectImageUrl(
        this.backgroundImageStore.imageUrl,
        runOptions,
      );
      const removed = this.removeYolo26PredictionNodes(
        sourcesToReplace,
        region,
      );
      const inserted = this.insertYolo26Predictions(result.predictions);
      const deduplicated = this.removeDuplicateYolo26PredictionNodes(
        runOptions,
        region,
      );
      const message =
        `Inserted ${inserted} ${this.formatSources(sourcesToReplace)} predicted symbols` +
        (region === null ? "" : " in the selected area") +
        (removed > 0
          ? ` after replacing ${removed} previous predictions`
          : "") +
        (deduplicated > 0
          ? ` and removing ${deduplicated} overlapping predictions.`
          : ".");

      this.jotaiStore.set(this.yolo26StatusBaseAtom, message);
      window.alert(message);
    } catch (e) {
      const message = String(e);
      console.error(e);
      this.jotaiStore.set(this.yolo26StatusBaseAtom, message);
      window.alert(message);
    } finally {
      this.jotaiStore.set(this.isYolo26RunningBaseAtom, false);
    }
  }

  public clearYolo26Predictions(): void {
    const removedCount = this.removeYolo26PredictionNodes();

    if (removedCount === 0) {
      this.jotaiStore.set(
        this.yolo26StatusBaseAtom,
        "No predicted symbols to clear.",
      );
      return;
    }

    this.selectionStore.clearSelection();
    const message = `Removed ${removedCount} predicted symbols.`;
    this.jotaiStore.set(this.yolo26StatusBaseAtom, message);
  }

  private removeDuplicateYolo26PredictionNodes(
    options: Yolo26DetectionOptions = DEFAULT_YOLO26_DETECTION_OPTIONS,
    region: DOMRect | null = null,
  ): number {
    const predictionNodes = this.notationGraphStore.nodes
      .filter(
        (node) =>
          this.isYolo26PredictionNode(node) &&
          (region === null || this.nodeBelongsToRegion(node, region)),
      )
      .sort(
        (a, b) =>
          this.getPredictionConfidence(b) - this.getPredictionConfidence(a),
      );
    const keepNodes: Node[] = [];
    const removeNodeIds: number[] = [];

    for (const candidate of predictionNodes) {
      const duplicate = keepNodes.some((kept) =>
        this.areDuplicatePredictionNodes(candidate, kept, options),
      );
      if (duplicate) {
        removeNodeIds.push(candidate.id);
      } else {
        keepNodes.push(candidate);
      }
    }

    for (const nodeId of removeNodeIds) {
      if (this.notationGraphStore.hasNode(nodeId)) {
        this.notationGraphStore.removeNodeWithLinks(nodeId);
      }
    }

    if (removeNodeIds.length === 0) {
      return 0;
    }

    this.selectionStore.clearSelection();
    return removeNodeIds.length;
  }

  private removeYolo26PredictionNodes(
    sources?: readonly SymbolDetectionSource[],
    region: DOMRect | null = null,
  ): number {
    const sourceSet = sources === undefined ? null : new Set(sources);
    const predictionNodeIds = this.notationGraphStore.nodes
      .filter((node) => {
        if (!this.isYolo26PredictionNode(node)) {
          return false;
        }
        if (region !== null && !this.nodeBelongsToRegion(node, region)) {
          return false;
        }
        if (sourceSet === null) {
          return true;
        }
        const source = this.getPredictionSource(node);
        return source === null || sourceSet.has(source);
      })
      .map((node) => node.id);

    for (const nodeId of predictionNodeIds) {
      if (this.notationGraphStore.hasNode(nodeId)) {
        this.notationGraphStore.removeNodeWithLinks(nodeId);
      }
    }

    return predictionNodeIds.length;
  }

  private insertYolo26Predictions(predictions: Yolo26Prediction[]): number {
    const insertedNodeIds: number[] = [];

    for (const prediction of predictions) {
      const node: Node = {
        id: this.notationGraphStore.getFreeId(),
        className: prediction.className,
        top: prediction.top,
        left: prediction.left,
        width: prediction.width,
        height: prediction.height,
        syntaxInlinks: [],
        syntaxOutlinks: [],
        precedenceInlinks: [],
        precedenceOutlinks: [],
        decodedMask: null,
        textTranscription: null,
        data: {
          symbol_detector_prediction: {
            type: "str",
            value: "true",
          },
          symbol_detector_source: {
            type: "str",
            value: prediction.source,
          },
          symbol_detector_model_key: {
            type: "str",
            value: prediction.modelKey,
          },
          symbol_detector_model_label: {
            type: "str",
            value: prediction.modelLabel,
          },
          symbol_detector_backend: {
            type: "str",
            value: prediction.backend,
          },
          symbol_detector_confidence: {
            type: "float",
            value: prediction.confidence.toFixed(6),
          },
          symbol_detector_class_id: {
            type: "int",
            value: String(prediction.classId),
          },
          symbol_detector_raw_class: {
            type: "str",
            value: prediction.rawClassName,
          },
          yolo26_combined: {
            type: "str",
            value: "true",
          },
          yolo26_combined_confidence: {
            type: "float",
            value: prediction.confidence.toFixed(6),
          },
          yolo26_combined_class_id: {
            type: "int",
            value: String(prediction.classId),
          },
          yolo26_combined_raw_class: {
            type: "str",
            value: prediction.rawClassName,
          },
        },
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

  private hasSimilarExistingNode(prediction: Yolo26Prediction): boolean {
    const predictedBox = this.predictionToBox(prediction);

    return this.notationGraphStore.nodes.some((node) => {
      if (node.className !== prediction.className) {
        return false;
      }
      const existingBox = this.nodeToBox(node);
      return (
        this.computeIou(predictedBox, existingBox) >= 0.7 &&
        this.computeAreaRatio(predictedBox, existingBox) >= 0.7
      );
    });
  }

  private countYolo26PredictionNodes(): number {
    return this.notationGraphStore.nodes.filter((node) =>
      this.isYolo26PredictionNode(node),
    ).length;
  }

  private getRecognitionRegion(
    options: SymbolDetectionRunOptions,
  ): DOMRect | null {
    const { roiLeft, roiTop, roiWidth, roiHeight } = options;
    if (
      roiLeft === undefined ||
      roiTop === undefined ||
      roiWidth === undefined ||
      roiHeight === undefined
    ) {
      return null;
    }
    if (
      !Number.isFinite(roiLeft) ||
      !Number.isFinite(roiTop) ||
      !Number.isFinite(roiWidth) ||
      !Number.isFinite(roiHeight) ||
      roiWidth <= 0 ||
      roiHeight <= 0
    ) {
      return null;
    }
    return new DOMRect(roiLeft, roiTop, roiWidth, roiHeight);
  }

  private isYolo26PredictionNode(node: Node): boolean {
    return (
      node.data["symbol_detector_prediction"]?.value === "true" ||
      node.data["yolo26_combined"]?.value === "true"
    );
  }

  private buildDefaultSymbolDetectionRunOptions(): SymbolDetectionRunOptions {
    return {
      ...DEFAULT_YOLO26_DETECTION_OPTIONS,
      largeModelKey: DEFAULT_LARGE_DETECTION_MODEL_KEY,
      smallModelKey: DEFAULT_SMALL_DETECTION_MODEL_KEY,
      runLarge: true,
      runSmall: true,
      deduplicate: true,
    };
  }

  private getRunSources(
    options: Pick<SymbolDetectionRunOptions, "runLarge" | "runSmall">,
  ): SymbolDetectionSource[] {
    const sources: SymbolDetectionSource[] = [];
    if (options.runLarge) {
      sources.push("large");
    }
    if (options.runSmall) {
      sources.push("small");
    }
    return sources;
  }

  private formatSources(sources: readonly SymbolDetectionSource[]): string {
    if (sources.length === 2) {
      return "large and small";
    }
    return sources[0] ?? "selected";
  }

  private getPredictionSource(node: Node): SymbolDetectionSource | null {
    const source = node.data["symbol_detector_source"]?.value;
    if (source === "large" || source === "small") {
      return source;
    }
    return null;
  }

  private getPredictionConfidence(node: Node): number {
    const value =
      node.data["symbol_detector_confidence"]?.value ??
      node.data["yolo26_combined_confidence"]?.value ??
      "0";
    const confidence = Number(value);
    return Number.isFinite(confidence) ? confidence : 0;
  }

  private areDuplicatePredictionNodes(
    candidate: Node,
    kept: Node,
    options: Yolo26DetectionOptions,
  ): boolean {
    const sameClass = candidate.className === kept.className;
    const iouThreshold = sameClass ? options.sameClassIou : options.xclassIou;
    const areaThreshold = sameClass
      ? options.sameClassAreaRatio
      : options.xclassAreaRatio;
    const candidateBox = this.nodeToBox(candidate);
    const keptBox = this.nodeToBox(kept);
    return (
      this.computeIou(candidateBox, keptBox) >= iouThreshold &&
      this.computeAreaRatio(candidateBox, keptBox) >= areaThreshold
    );
  }

  private predictionToBox(prediction: Yolo26Prediction): DOMRect {
    return new DOMRect(
      prediction.left,
      prediction.top,
      prediction.width,
      prediction.height,
    );
  }

  private nodeToBox(node: Node): DOMRect {
    return new DOMRect(node.left, node.top, node.width, node.height);
  }

  private nodeBelongsToRegion(node: Node, region: DOMRect): boolean {
    const nodeBox = this.nodeToBox(node);
    const nodeArea = nodeBox.width * nodeBox.height;
    if (nodeArea <= 0) {
      return false;
    }
    return (
      this.computeIntersectionArea(nodeBox, region) / nodeArea >=
      MainMenuController.REGION_REPLACE_MIN_COVERAGE
    );
  }

  private computeIntersectionArea(a: DOMRect, b: DOMRect): number {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  private computeIou(a: DOMRect, b: DOMRect): number {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const union = a.width * a.height + b.width * b.height - intersection;
    return intersection / Math.max(union, 1e-6);
  }

  private computeAreaRatio(a: DOMRect, b: DOMRect): number {
    const aArea = a.width * a.height;
    const bArea = b.width * b.height;
    return Math.min(aArea, bArea) / Math.max(aArea, bArea, 1e-6);
  }
}
