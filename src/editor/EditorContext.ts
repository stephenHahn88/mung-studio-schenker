import { createContext, useMemo } from "react";
import { NotationGraphStore } from "./model/notation-graph-store/NotationGraphStore";
import { Node } from "../mung/Node";
import { MungFileMetadata } from "../mung/MungFileMetadata";
import { SelectionStore } from "./model/SelectionStore";
import { ClassVisibilityStore } from "./model/ClassVisibilityStore";
import { EditorStateStore } from "./model/EditorStateStore";
import { AutosaveStore } from "./model/AutosaveStore";
import { PythonRuntime } from "../../pyodide/PythonRuntime";
import { getDefaultStore } from "jotai";
import { JotaiStore } from "./model/JotaiStore";
import { ToolbeltController } from "./controller/ToolbeltController";
import { ZoomController } from "./controller/ZoomController";
import { HighlightController } from "./controller/HighlightController";
import { SelectionController } from "./controller/SelectionController";
import { RedrawTrigger } from "./controller/RedrawTrigger";
import { PolygonToolsController } from "./controller/tools/PolygonToolsController";
import { NodeEditingController } from "./controller/tools/NodeEditingController";
import { MainMenuController } from "./controller/MainMenuController";
import { MousePointerController } from "./controller/MousePointerController";
import { SettingsStore } from "./model/SettingsStore";
import { ValidationStore } from "./model/ValidationStore";
import { ValidationController } from "./controller/ValidationController";
import { DeltaInterpreter } from "./model/DeltaInterpreter";
import { BackgroundImageStore } from "./model/BackgroundImageStore";
import { StafflinesToolController } from "./controller/tools/StafflinesToolController";
import { StaffGeometryStore } from "./model/StaffGeometryStore";
import { NodeNavigationController } from "./controller/NodeNavigationController";
import { HistoryStore } from "./model/HistoryStore";
import { RecognitionRegionController } from "./controller/RecognitionRegionController";
import { BboxEditingController } from "./controller/BboxEditingController";
import { QuickRectNodeController } from "./controller/tools/QuickRectNodeController";
import { CollabController, CollabConfig } from "./controller/CollabController";

/**
 * All fields present in the editor component's global context
 */
export interface EditorContextState {
  readonly backgroundImageStore: BackgroundImageStore;
  readonly notationGraphStore: NotationGraphStore;
  readonly selectionStore: SelectionStore;
  readonly classVisibilityStore: ClassVisibilityStore;
  readonly staffGeometryStore: StaffGeometryStore;
  readonly editorStateStore: EditorStateStore;
  readonly historyStore: HistoryStore;
  readonly autosaveStore: AutosaveStore;
  readonly settingsStore: SettingsStore;
  readonly validationStore: ValidationStore;
  readonly deltaInterpreter: DeltaInterpreter;

  readonly pythonRuntime: PythonRuntime;

  readonly validationController: ValidationController;
  readonly redrawTrigger: RedrawTrigger;
  readonly toolbeltController: ToolbeltController;
  readonly zoomController: ZoomController;
  readonly mousePointerController: MousePointerController;
  readonly highlightController: HighlightController;
  readonly bboxEditingController: BboxEditingController;
  readonly selectionController: SelectionController;
  readonly nodeEditingController: NodeEditingController;
  readonly quickRectNodeController: QuickRectNodeController;
  readonly polygonToolsController: PolygonToolsController;
  readonly stafflinesToolController: StafflinesToolController;
  readonly mainMenuController: MainMenuController;
  readonly recognitionRegionController: RecognitionRegionController;
  readonly nodeNavigationController: NodeNavigationController;
  readonly collabController: CollabController | null;
}

/**
 * Creates all services and stores present in the editor context
 */
export function useConstructContextServices(
  initialNodes: readonly Node[],
  initialMungFileMetadata: MungFileMetadata,
  backgroundImageUrl: string | null,
  collabConfig: CollabConfig | null = null,
): EditorContextState {
  const jotaiStore: JotaiStore = useMemo(() => getDefaultStore(), []);

  const backgroundImageStore = useMemo(
    () => new BackgroundImageStore(backgroundImageUrl, jotaiStore),
    [],
  );

  const notationGraphStore = useMemo(
    () => new NotationGraphStore(initialNodes, initialMungFileMetadata),
    [],
  );

  const selectionStore = useMemo(
    () => new SelectionStore(notationGraphStore),
    [],
  );

  const classVisibilityStore = useMemo(
    () => new ClassVisibilityStore(notationGraphStore),
    [],
  );

  const staffGeometryStore = useMemo(
    () => new StaffGeometryStore(notationGraphStore),
    [],
  );

  const editorStateStore = useMemo(() => new EditorStateStore(jotaiStore), []);

  const historyStore = useMemo(
    () => new HistoryStore(notationGraphStore, jotaiStore),
    [],
  );

  const autosaveStore = useMemo(
    () => new AutosaveStore(notationGraphStore),
    [],
  );

  const settingsStore = useMemo(() => new SettingsStore(jotaiStore), []);

  const validationStore = useMemo(
    () => new ValidationStore(jotaiStore, notationGraphStore),
    [],
  );

  const deltaInterpreter = useMemo(
    () => new DeltaInterpreter(notationGraphStore),
    [],
  );

  const pythonRuntime = useMemo(() => PythonRuntime.resolveInstance(), []);

  const validationController = useMemo(
    () =>
      new ValidationController(
        jotaiStore,
        validationStore,
        notationGraphStore,
        pythonRuntime,
        deltaInterpreter,
      ),
    [],
  );

  const redrawTrigger = useMemo(() => new RedrawTrigger(), []);

  const toolbeltController = useMemo(
    () => new ToolbeltController(jotaiStore),
    [],
  );

  const zoomController = useMemo(
    () => new ZoomController(jotaiStore, toolbeltController),
    [],
  );

  const mousePointerController = useMemo(
    () => new MousePointerController(zoomController),
    [],
  );

  const highlightController = useMemo(
    () =>
      new HighlightController(
        jotaiStore,
        notationGraphStore,
        classVisibilityStore,
        mousePointerController,
        toolbeltController,
        staffGeometryStore,
      ),
    [],
  );

  const selectionController = useMemo(
    () =>
      new SelectionController(
        jotaiStore,
        notationGraphStore,
        classVisibilityStore,
        selectionStore,
        editorStateStore,
        highlightController,
        zoomController,
        toolbeltController,
      ),
    [],
  );

  const bboxEditingController = useMemo(
    () =>
      new BboxEditingController(
        jotaiStore,
        notationGraphStore,
        selectionStore,
        toolbeltController,
        zoomController,
      ),
    [],
  );

  const nodeEditingController = useMemo(
    () =>
      new NodeEditingController(
        jotaiStore,
        notationGraphStore,
        classVisibilityStore,
        selectionStore,
        toolbeltController,
        zoomController,
        redrawTrigger,
      ),
    [],
  );

  const quickRectNodeController = useMemo(
    () =>
      new QuickRectNodeController(
        jotaiStore,
        zoomController,
        toolbeltController,
        nodeEditingController,
      ),
    [],
  );

  const polygonToolsController = useMemo(
    () =>
      new PolygonToolsController(
        jotaiStore,
        zoomController,
        mousePointerController,
        redrawTrigger,
        nodeEditingController,
        backgroundImageStore,
        pythonRuntime,
      ),
    [],
  );

  const stafflinesToolController = useMemo(
    () =>
      new StafflinesToolController(
        jotaiStore,
        nodeEditingController,
        pythonRuntime,
        notationGraphStore,
        selectionStore,
        toolbeltController,
      ),
    [],
  );

  const mainMenuController = useMemo(
    () =>
      new MainMenuController(
        jotaiStore,
        notationGraphStore,
        selectionStore,
        zoomController,
        toolbeltController,
        editorStateStore,
        pythonRuntime,
        classVisibilityStore,
        backgroundImageStore,
        historyStore,
      ),
    [],
  );

  const recognitionRegionController = useMemo(
    () =>
      new RecognitionRegionController(
        jotaiStore,
        zoomController,
        toolbeltController,
        mainMenuController,
      ),
    [],
  );

  const nodeNavigationController = useMemo(
    () =>
      new NodeNavigationController(
        jotaiStore,
        notationGraphStore,
        selectionStore,
        zoomController,
      ),
    [],
  );

  const collabController = useMemo(
    () =>
      collabConfig
        ? new CollabController(
            jotaiStore,
            notationGraphStore,
            selectionStore,
            collabConfig,
          )
        : null,
    [],
  );

  return {
    backgroundImageStore,
    notationGraphStore,
    selectionStore,
    classVisibilityStore,
    staffGeometryStore,
    editorStateStore,
    historyStore,
    autosaveStore,
    settingsStore,
    validationStore,
    deltaInterpreter,

    pythonRuntime,

    validationController,
    redrawTrigger,
    toolbeltController,
    zoomController,
    mousePointerController,
    highlightController,
    bboxEditingController,
    selectionController,
    nodeEditingController,
    quickRectNodeController,
    polygonToolsController,
    stafflinesToolController,
    mainMenuController,
    recognitionRegionController,
    nodeNavigationController,
    collabController,
  };
}

/**
 * The react context for the editor component
 */
export const EditorContext = createContext<EditorContextState>(null!);
