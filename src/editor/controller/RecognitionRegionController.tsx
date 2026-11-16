import { JSX, useEffect, useRef } from "react";
import { atom, Atom } from "jotai";
import { IController } from "./IController";
import { JotaiStore } from "../model/JotaiStore";
import { ZoomController } from "./ZoomController";
import { ToolbeltController } from "./ToolbeltController";
import { EditorTool } from "../model/EditorTool";
import {
  MainMenuController,
  MODEL_ACTION_LABELS,
  ModelAction,
  ModelRunOptions,
} from "./MainMenuController";
import {
  RELATION_INFERENCE_ENABLED,
  RELATION_INFERENCE_UNAVAILABLE_MESSAGE,
  SYMBOL_INFERENCE_ENABLED,
  SYMBOL_INFERENCE_UNAVAILABLE_MESSAGE,
} from "../../utils/featureFlags";

interface PendingRegionRun {
  readonly action: ModelAction;
  readonly documentName: string;
  readonly options: ModelRunOptions;
}

/** Runs a model action on a rectangle dragged on the page. */
export class RecognitionRegionController implements IController {
  public readonly controllerName = "RecognitionRegionController";

  private readonly jotaiStore: JotaiStore;
  private readonly zoomController: ZoomController;
  private readonly toolbeltController: ToolbeltController;
  private readonly mainMenuController: MainMenuController;

  constructor(
    jotaiStore: JotaiStore,
    zoomController: ZoomController,
    toolbeltController: ToolbeltController,
    mainMenuController: MainMenuController,
  ) {
    this.jotaiStore = jotaiStore;
    this.zoomController = zoomController;
    this.toolbeltController = toolbeltController;
    this.mainMenuController = mainMenuController;
  }

  private readonly isRegionSelectionActiveBaseAtom = atom<boolean>(false);

  public readonly isRegionSelectionActiveAtom = atom((get) =>
    get(this.isRegionSelectionActiveBaseAtom),
  );

  public readonly isEnabledAtom: Atom<boolean> = atom(
    (get) =>
      get(this.isRegionSelectionActiveBaseAtom) &&
      get(this.toolbeltController.currentToolAtom) ===
        EditorTool.RecognitionRegion,
  );

  public get isEnabled(): boolean {
    return this.jotaiStore.get(this.isEnabledAtom);
  }

  private regionRectangle: SVGRectElement | null = null;
  private pending: PendingRegionRun | null = null;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragEndX = 0;
  private dragEndY = 0;

  public startRegionSelection(
    action: ModelAction,
    documentName: string,
    options: ModelRunOptions = {},
  ): void {
    const enabled =
      action === "symbols"
        ? SYMBOL_INFERENCE_ENABLED
        : RELATION_INFERENCE_ENABLED;
    if (!enabled) {
      const message =
        action === "symbols"
          ? SYMBOL_INFERENCE_UNAVAILABLE_MESSAGE
          : RELATION_INFERENCE_UNAVAILABLE_MESSAGE;
      this.mainMenuController.setModelStatus(message);
      window.alert(message);
      return;
    }
    if (!this.jotaiStore.get(this.mainMenuController.canRunModelsAtom)) {
      this.mainMenuController.setModelStatus(
        "Models cannot run on the current page right now.",
      );
      return;
    }

    this.pending = { action, documentName, options };
    this.isDragging = false;
    this.hideRegionRectangle();
    this.jotaiStore.set(this.isRegionSelectionActiveBaseAtom, true);
    this.toolbeltController.setCurrentTool(EditorTool.RecognitionRegion);
    this.mainMenuController.setModelStatus(
      `Drag an area on the page for ${MODEL_ACTION_LABELS[action]}, or press Escape to cancel.`,
    );
  }

  public cancelRegionSelection(): void {
    this.stopRegionSelection({
      returnToPointer: true,
      status: "Area selection canceled.",
    });
  }

  public onDisabled(): void {
    if (this.jotaiStore.get(this.isRegionSelectionActiveBaseAtom)) {
      this.stopRegionSelection({
        returnToPointer: false,
        status: "Area selection canceled.",
      });
      return;
    }
    this.hideRegionRectangle();
  }

  public onKeyDown(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.cancelRegionSelection();
  }

  public onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;

    const point = this.getScenePoint(e);
    this.isDragging = true;
    this.dragStartX = point.x;
    this.dragStartY = point.y;
    this.dragEndX = point.x;
    this.dragEndY = point.y;
    this.updateRegionRectangle();
  }

  public onMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;

    const point = this.getScenePoint(e);
    this.dragEndX = point.x;
    this.dragEndY = point.y;
    this.updateRegionRectangle();
  }

  public onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (!this.isDragging) return;

    const point = this.getScenePoint(e);
    this.dragEndX = point.x;
    this.dragEndY = point.y;
    const region = this.getNormalizedRegion();
    const pending = this.pending;

    this.stopRegionSelection({ returnToPointer: true, status: null });

    if (pending === null) {
      return;
    }

    if (region.width < 8 || region.height < 8) {
      this.mainMenuController.setModelStatus("The selected area is too small.");
      return;
    }

    void this.mainMenuController.runModel(
      pending.action,
      pending.documentName,
      new DOMRect(
        Math.round(region.x),
        Math.round(region.y),
        Math.max(1, Math.round(region.width)),
        Math.max(1, Math.round(region.height)),
      ),
      pending.options,
    );
  }

  private stopRegionSelection(options: {
    readonly returnToPointer: boolean;
    readonly status: string | null;
  }): void {
    this.pending = null;
    this.isDragging = false;
    this.hideRegionRectangle();
    this.jotaiStore.set(this.isRegionSelectionActiveBaseAtom, false);
    if (
      options.returnToPointer &&
      this.toolbeltController.currentTool === EditorTool.RecognitionRegion
    ) {
      this.toolbeltController.setCurrentTool(EditorTool.Pointer);
    }
    if (options.status !== null) {
      this.mainMenuController.setModelStatus(options.status);
    }
  }

  private getScenePoint(e: MouseEvent): {
    readonly x: number;
    readonly y: number;
  } {
    const transform = this.zoomController.currentTransform;
    return {
      x: transform.invertX(e.offsetX),
      y: transform.invertY(e.offsetY),
    };
  }

  private getNormalizedRegion(): DOMRect {
    const x = Math.min(this.dragStartX, this.dragEndX);
    const y = Math.min(this.dragStartY, this.dragEndY);
    const width = Math.abs(this.dragStartX - this.dragEndX);
    const height = Math.abs(this.dragStartY - this.dragEndY);
    return new DOMRect(x, y, width, height);
  }

  private updateRegionRectangle(): void {
    if (this.regionRectangle === null) return;

    if (!this.isDragging) {
      this.hideRegionRectangle();
      return;
    }

    const region = this.getNormalizedRegion();
    this.regionRectangle.style.display = "block";
    this.regionRectangle.setAttribute("x", String(region.x));
    this.regionRectangle.setAttribute("y", String(region.y));
    this.regionRectangle.setAttribute("width", String(region.width));
    this.regionRectangle.setAttribute("height", String(region.height));
  }

  private hideRegionRectangle(): void {
    if (this.regionRectangle !== null) {
      this.regionRectangle.style.display = "none";
    }
  }

  public renderSVG(): JSX.Element | null {
    const regionRectangleRef = useRef<SVGRectElement | null>(null);

    useEffect(() => {
      this.regionRectangle = regionRectangleRef.current;
      return () => {
        this.regionRectangle = null;
      };
    }, []);

    return (
      <rect
        ref={regionRectangleRef}
        x={0}
        y={0}
        width={0}
        height={0}
        fill="color-mix(in srgb, var(--joy-palette-warning-400) 18%, transparent)"
        stroke="var(--joy-palette-warning-400)"
        strokeWidth="calc(var(--scene-screen-pixel) * 2)"
        strokeDasharray="10 6"
        vectorEffect="non-scaling-stroke"
        style={{
          display: "none",
        }}
      />
    );
  }
}
