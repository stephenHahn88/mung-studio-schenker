import { JSX, useEffect, useRef } from "react";
import { atom, Atom } from "jotai";
import { IController } from "./IController";
import { JotaiStore } from "../model/JotaiStore";
import { ZoomController } from "./ZoomController";
import { ToolbeltController } from "./ToolbeltController";
import { EditorTool } from "../model/EditorTool";
import { MainMenuController } from "./MainMenuController";
import { SymbolDetectionRunOptions } from "./Yolo26DetectionApi";

/**
 * Handles the temporary drag-to-run recognition area tool.
 */
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
  private pendingOptions: SymbolDetectionRunOptions | null = null;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragEndX = 0;
  private dragEndY = 0;

  public startRegionSelection(options: SymbolDetectionRunOptions): void {
    if (!this.jotaiStore.get(this.mainMenuController.canRunYolo26CombinedAtom)) {
      this.mainMenuController.setYolo26Status(
        "Recognition is not ready for the current page.",
      );
      return;
    }

    this.pendingOptions = {
      ...options,
      deduplicate: true,
    };
    this.isDragging = false;
    this.hideRegionRectangle();
    this.jotaiStore.set(this.isRegionSelectionActiveBaseAtom, true);
    this.toolbeltController.setCurrentTool(EditorTool.RecognitionRegion);
    this.mainMenuController.setYolo26Status(
      "Drag a recognition area on the page, or press Escape to cancel.",
    );
  }

  public cancelRegionSelection(): void {
    this.stopRegionSelection({
      returnToPointer: true,
      status: "Region recognition canceled.",
    });
  }

  public onDisabled(): void {
    if (this.jotaiStore.get(this.isRegionSelectionActiveBaseAtom)) {
      this.stopRegionSelection({
        returnToPointer: false,
        status: "Region recognition canceled.",
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
    const options = this.pendingOptions;

    this.stopRegionSelection({ returnToPointer: true, status: null });

    if (options === null) {
      return;
    }

    if (region.width < 8 || region.height < 8) {
      this.mainMenuController.setYolo26Status(
        "Recognition area is too small.",
      );
      return;
    }

    void this.mainMenuController.runYolo26Combined({
      ...options,
      roiLeft: Math.round(region.x),
      roiTop: Math.round(region.y),
      roiWidth: Math.max(1, Math.round(region.width)),
      roiHeight: Math.max(1, Math.round(region.height)),
      deduplicate: true,
    });
  }

  private stopRegionSelection(options: {
    readonly returnToPointer: boolean;
    readonly status: string | null;
  }): void {
    this.pendingOptions = null;
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
      this.mainMenuController.setYolo26Status(options.status);
    }
  }

  private getScenePoint(e: MouseEvent): { readonly x: number; readonly y: number } {
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
