import { JSX, useEffect, useRef } from "react";
import { atom, Atom } from "jotai";
import { IController } from "../IController";
import { JotaiStore } from "../../model/JotaiStore";
import { ZoomController } from "../ZoomController";
import { ToolbeltController } from "../ToolbeltController";
import { EditorTool } from "../../model/EditorTool";
import { NodeEditingController } from "./NodeEditingController";

/**
 * Drags shorter than this (in scene-space pixels) are treated as a click and
 * ignored, so an accidental Ctrl+click does not create a degenerate node.
 */
const MIN_QUICK_RECT_SIZE = 4;

/**
 * Implements the "quick rectangle" annotation gesture: holding Ctrl (or Cmd)
 * and dragging the mouse sweeps out a rectangle that becomes the bounding box
 * of a brand-new node directly (a full-rectangle mask), and then jumps straight
 * into the class-name selection. This is a fast alternative to drawing a polygon
 * for symbols that have a regular, box-like shape.
 *
 * Works while the Pointer or Node Editing tool is active. The actual node
 * creation is delegated to the NodeEditingController.
 */
export class QuickRectNodeController implements IController {
  public readonly controllerName = "QuickRectNodeController";

  private readonly jotaiStore: JotaiStore;
  private readonly zoomController: ZoomController;
  private readonly toolbeltController: ToolbeltController;
  private readonly nodeEditingController: NodeEditingController;

  constructor(
    jotaiStore: JotaiStore,
    zoomController: ZoomController,
    toolbeltController: ToolbeltController,
    nodeEditingController: NodeEditingController,
  ) {
    this.jotaiStore = jotaiStore;
    this.zoomController = zoomController;
    this.toolbeltController = toolbeltController;
    this.nodeEditingController = nodeEditingController;
  }

  public readonly isEnabledAtom: Atom<boolean> = atom((get) => {
    const tool = get(this.toolbeltController.currentToolAtom);
    return tool === EditorTool.Pointer || tool === EditorTool.NodeEditing;
  });

  public get isEnabled(): boolean {
    return this.jotaiStore.get(this.isEnabledAtom);
  }

  ///////////
  // State //
  ///////////

  private rectElement: SVGRectElement | null = null;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragEndX = 0;
  private dragEndY = 0;

  /**
   * True when the quick-rectangle modifier (Ctrl on Win/Linux, Cmd on Mac) is
   * being held. We accept both so the gesture works across platforms.
   */
  private isQuickModifier(e: MouseEvent): boolean {
    return e.ctrlKey || e.metaKey;
  }

  ///////////////////////
  // Mouse interaction //
  ///////////////////////

  public onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // LMB only
    if (!this.isQuickModifier(e)) return; // only the Ctrl/Cmd + drag gesture

    const point = this.getScenePoint(e);
    this.isDragging = true;
    this.dragStartX = point.x;
    this.dragStartY = point.y;
    this.dragEndX = point.x;
    this.dragEndY = point.y;
    this.updateRectangle();
  }

  public onMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;

    const point = this.getScenePoint(e);
    this.dragEndX = point.x;
    this.dragEndY = point.y;
    this.updateRectangle();
  }

  public onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return; // LMB only
    if (!this.isDragging) return;

    const point = this.getScenePoint(e);
    this.dragEndX = point.x;
    this.dragEndY = point.y;
    this.isDragging = false;

    const region = this.getNormalizedRegion();
    this.hideRectangle();

    // ignore clicks / tiny drags
    if (
      region.width < MIN_QUICK_RECT_SIZE ||
      region.height < MIN_QUICK_RECT_SIZE
    ) {
      return;
    }

    this.nodeEditingController.createRectangularNodeFromSceneRect(region);
  }

  public onDisabled(): void {
    this.isDragging = false;
    this.hideRectangle();
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

  ///////////////
  // Rendering //
  ///////////////

  private updateRectangle(): void {
    if (this.rectElement === null) return;

    if (!this.isDragging) {
      this.hideRectangle();
      return;
    }

    const region = this.getNormalizedRegion();
    this.rectElement.style.display = "block";
    this.rectElement.setAttribute("x", String(region.x));
    this.rectElement.setAttribute("y", String(region.y));
    this.rectElement.setAttribute("width", String(region.width));
    this.rectElement.setAttribute("height", String(region.height));
  }

  private hideRectangle(): void {
    if (this.rectElement !== null) {
      this.rectElement.style.display = "none";
    }
  }

  public renderSVG(): JSX.Element | null {
    const rectRef = useRef<SVGRectElement | null>(null);

    useEffect(() => {
      this.rectElement = rectRef.current;
      return () => {
        this.rectElement = null;
      };
    }, []);

    return (
      <rect
        ref={rectRef}
        x={0}
        y={0}
        width={0}
        height={0}
        fill="color-mix(in srgb, var(--joy-palette-success-400) 18%, transparent)"
        stroke="var(--joy-palette-success-400)"
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
