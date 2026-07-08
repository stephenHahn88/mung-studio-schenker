import { JSX } from "react";
import { Atom, atom, useAtomValue } from "jotai";
import { IController } from "./IController";
import { JotaiStore } from "../model/JotaiStore";
import { NotationGraphStore } from "../model/notation-graph-store/NotationGraphStore";
import { SelectionStore } from "../model/SelectionStore";
import { ToolbeltController } from "./ToolbeltController";
import { ZoomController } from "./ZoomController";
import { EditorTool } from "../model/EditorTool";
import { Node } from "../../mung/Node";

type BboxEditAction =
  | "move"
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

interface BboxRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface BboxInteractionState {
  readonly previewRect: BboxRect | null;
  readonly activeAction: BboxEditAction | null;
  readonly hoverAction: BboxEditAction | null;
}

interface ActiveDrag {
  readonly nodeId: number;
  readonly action: BboxEditAction;
  readonly startPointer: DOMPointReadOnly;
  readonly startRect: BboxRect;
}

const EMPTY_INTERACTION_STATE: BboxInteractionState = {
  previewRect: null,
  activeAction: null,
  hoverAction: null,
};

const MIN_BBOX_SIZE = 2;

/**
 * Lets annotators move and resize any node via bounding-box handles. Moving
 * carries the node's pixel mask along with the box; resizing keeps the mask
 * pixels that still fall inside the new box, drops those now outside it, and
 * leaves any newly-exposed area empty (see commitRect / cropMaskToRect). A node
 * with no mask (null) represents "fills the whole box" and stays that way.
 */
export class BboxEditingController implements IController {
  public readonly controllerName = "BboxEditingController";

  private readonly jotaiStore: JotaiStore;
  private readonly notationGraphStore: NotationGraphStore;
  private readonly selectionStore: SelectionStore;
  private readonly toolbeltController: ToolbeltController;
  private readonly zoomController: ZoomController;

  constructor(
    jotaiStore: JotaiStore,
    notationGraphStore: NotationGraphStore,
    selectionStore: SelectionStore,
    toolbeltController: ToolbeltController,
    zoomController: ZoomController,
  ) {
    this.jotaiStore = jotaiStore;
    this.notationGraphStore = notationGraphStore;
    this.selectionStore = selectionStore;
    this.toolbeltController = toolbeltController;
    this.zoomController = zoomController;
  }

  private activeDrag: ActiveDrag | null = null;

  private readonly interactionBaseAtom = atom<BboxInteractionState>(
    EMPTY_INTERACTION_STATE,
  );

  public readonly cursorAtom: Atom<string | null> = atom((get) => {
    const state = get(this.interactionBaseAtom);
    const action = state.activeAction ?? state.hoverAction;
    if (action === null) return null;
    return this.cursorForAction(action);
  });

  public readonly isEnabledAtom: Atom<boolean> = atom((get) => {
    if (get(this.toolbeltController.currentToolAtom) !== EditorTool.Pointer) {
      return false;
    }
    const selectedNodes = get(this.selectionStore.selectedNodesAtom);
    return (
      selectedNodes.length === 1 && this.isEditableBboxNode(selectedNodes[0])
    );
  });

  public get isEnabled(): boolean {
    return this.jotaiStore.get(this.isEnabledAtom);
  }

  public onDisabled(): void {
    this.activeDrag = null;
    this.setInteractionState(EMPTY_INTERACTION_STATE);
  }

  public onMouseMove(e: MouseEvent): void {
    const point = this.getScenePoint(e);

    if (this.activeDrag !== null) {
      const previewRect = this.rectForDrag(this.activeDrag, point);
      this.setInteractionState({
        previewRect,
        activeAction: this.activeDrag.action,
        hoverAction: this.activeDrag.action,
      });
      e.stopImmediatePropagation();
      return;
    }

    const node = this.getEditableSelectedNode();
    const hoverAction = node === null ? null : this.actionAtPoint(node, point);
    const state = this.jotaiStore.get(this.interactionBaseAtom);
    if (state.hoverAction !== hoverAction || state.previewRect !== null) {
      this.setInteractionState({
        previewRect: null,
        activeAction: null,
        hoverAction,
      });
    }
  }

  public onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    // Ctrl/Cmd + Shift + click is reserved for edge creation; don't start a
    // bbox move/resize drag on that gesture.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) return;

    const node = this.getEditableSelectedNode();
    if (node === null) return;

    const point = this.getScenePoint(e);
    const action = this.actionAtPoint(node, point);
    if (action === null) return;

    const startRect = this.nodeToRect(node);
    this.activeDrag = {
      nodeId: node.id,
      action,
      startPointer: point,
      startRect,
    };
    this.setInteractionState({
      previewRect: startRect,
      activeAction: action,
      hoverAction: action,
    });
    e.stopImmediatePropagation();
  }

  public onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (this.activeDrag === null) return;

    const activeDrag = this.activeDrag;
    const state = this.jotaiStore.get(this.interactionBaseAtom);
    const previewRect = state.previewRect ?? activeDrag.startRect;
    this.activeDrag = null;
    this.setInteractionState(EMPTY_INTERACTION_STATE);

    if (this.notationGraphStore.hasNode(activeDrag.nodeId)) {
      const node = this.notationGraphStore.getNode(activeDrag.nodeId);
      if (this.isEditableBboxNode(node)) {
        this.commitRect(node, previewRect);
      }
    }

    e.stopImmediatePropagation();
  }

  private getEditableSelectedNode(): Node | null {
    if (this.selectionStore.selectedNodeIds.length !== 1) {
      return null;
    }
    const nodeId = this.selectionStore.selectedNodeIds[0];
    if (!this.notationGraphStore.hasNode(nodeId)) {
      return null;
    }
    const node = this.notationGraphStore.getNode(nodeId);
    return this.isEditableBboxNode(node) ? node : null;
  }

  private isEditableBboxNode(_node: Node): boolean {
    // Every node can be moved/resized via the bounding-box handles. The pixel
    // mask (if any) is carried/cropped to the new box on edit (see commitRect),
    // so it stays in sync with the box dimensions.
    return true;
  }

  private commitRect(node: Node, rect: BboxRect): void {
    const normalized = this.normalizeCommittedRect(rect);
    if (
      normalized.left === node.left &&
      normalized.top === node.top &&
      normalized.width === node.width &&
      normalized.height === node.height
    ) {
      return;
    }

    const oldRect = this.nodeToRect(node);
    const dimsChanged =
      normalized.width !== node.width || normalized.height !== node.height;

    // Re-anchor the pixel mask to the new bounding box:
    //  - move (size unchanged): the mask travels with the box (unchanged);
    //  - resize: keep mask pixels still inside the new box, drop those now
    //    outside it, and leave any newly-exposed area empty.
    // A null mask means "fills the whole box" and stays null.
    let decodedMask = node.decodedMask;
    if (decodedMask !== null && dimsChanged) {
      decodedMask = this.cropMaskToRect(decodedMask, oldRect, normalized);
    }

    this.notationGraphStore.updateNode({
      ...node,
      left: normalized.left,
      top: normalized.top,
      width: normalized.width,
      height: normalized.height,
      decodedMask,
    });
  }

  /**
   * Re-expresses a node's pixel mask for a resized bounding box. The mask is
   * treated as anchored in absolute scene coordinates: a pixel stays ink iff
   * its absolute position is still inside the new box. Cells of the new box
   * that lie outside the old box are left empty (transparent). The returned
   * ImageData has exactly the new box's dimensions, so it stays consistent with
   * the box (a hard requirement of the MuNG mask format).
   */
  private cropMaskToRect(
    mask: ImageData,
    oldRect: BboxRect,
    newRect: BboxRect,
  ): ImageData {
    const ow = mask.width;
    const oh = mask.height;
    const nw = newRect.width;
    const nh = newRect.height;
    const out = new ImageData(nw, nh); // zero-filled => expanded area is empty
    const src = mask.data;
    const dst = out.data;
    // old index for a new pixel (x,y): absolute (newLeft+x, newTop+y) - oldOrigin
    const dx = newRect.left - oldRect.left;
    const dy = newRect.top - oldRect.top;
    for (let y = 0; y < nh; y++) {
      const oy = y + dy;
      if (oy < 0 || oy >= oh) continue;
      for (let x = 0; x < nw; x++) {
        const ox = x + dx;
        if (ox < 0 || ox >= ow) continue;
        const si = (oy * ow + ox) * 4;
        const di = (y * nw + x) * 4;
        dst[di] = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
        dst[di + 3] = src[si + 3];
      }
    }
    return out;
  }

  private normalizeCommittedRect(rect: BboxRect): BboxRect {
    const left = Math.round(rect.left);
    const top = Math.round(rect.top);
    const right = Math.max(
      left + MIN_BBOX_SIZE,
      Math.round(rect.left + rect.width),
    );
    const bottom = Math.max(
      top + MIN_BBOX_SIZE,
      Math.round(rect.top + rect.height),
    );
    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
  }

  private nodeToRect(node: Node): BboxRect {
    return {
      left: node.left,
      top: node.top,
      width: node.width,
      height: node.height,
    };
  }

  private rectForDrag(
    activeDrag: ActiveDrag,
    point: DOMPointReadOnly,
  ): BboxRect {
    const rect = activeDrag.startRect;
    if (activeDrag.action === "move") {
      return {
        left: rect.left + point.x - activeDrag.startPointer.x,
        top: rect.top + point.y - activeDrag.startPointer.y,
        width: rect.width,
        height: rect.height,
      };
    }

    let left = rect.left;
    let top = rect.top;
    let right = rect.left + rect.width;
    let bottom = rect.top + rect.height;

    if (activeDrag.action.includes("w")) {
      left = Math.min(point.x, right - MIN_BBOX_SIZE);
    }
    if (activeDrag.action.includes("e")) {
      right = Math.max(point.x, left + MIN_BBOX_SIZE);
    }
    if (activeDrag.action.includes("n")) {
      top = Math.min(point.y, bottom - MIN_BBOX_SIZE);
    }
    if (activeDrag.action.includes("s")) {
      bottom = Math.max(point.y, top + MIN_BBOX_SIZE);
    }

    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
  }

  private actionAtPoint(
    node: Node,
    point: DOMPointReadOnly,
  ): BboxEditAction | null {
    const rect = this.nodeToRect(node);
    const handleSize = this.handleSizeSceneUnits();
    for (const handle of this.getHandles(rect)) {
      if (
        point.x >= handle.x - handleSize / 2 &&
        point.x <= handle.x + handleSize / 2 &&
        point.y >= handle.y - handleSize / 2 &&
        point.y <= handle.y + handleSize / 2
      ) {
        return handle.action;
      }
    }

    if (
      point.x >= rect.left &&
      point.x <= rect.left + rect.width &&
      point.y >= rect.top &&
      point.y <= rect.top + rect.height
    ) {
      return "move";
    }

    return null;
  }

  private getHandles(rect: BboxRect): {
    readonly action: BboxEditAction;
    readonly x: number;
    readonly y: number;
  }[] {
    const left = rect.left;
    const centerX = rect.left + rect.width / 2;
    const right = rect.left + rect.width;
    const top = rect.top;
    const centerY = rect.top + rect.height / 2;
    const bottom = rect.top + rect.height;
    return [
      { action: "nw", x: left, y: top },
      { action: "n", x: centerX, y: top },
      { action: "ne", x: right, y: top },
      { action: "e", x: right, y: centerY },
      { action: "se", x: right, y: bottom },
      { action: "s", x: centerX, y: bottom },
      { action: "sw", x: left, y: bottom },
      { action: "w", x: left, y: centerY },
    ];
  }

  private cursorForAction(action: BboxEditAction): string {
    switch (action) {
      case "move":
        return "move";
      case "n":
      case "s":
        return "ns-resize";
      case "e":
      case "w":
        return "ew-resize";
      case "ne":
      case "sw":
        return "nesw-resize";
      case "nw":
      case "se":
        return "nwse-resize";
    }
  }

  private handleSizeSceneUnits(): number {
    return 10 / this.zoomController.currentTransform.k;
  }

  private getScenePoint(e: MouseEvent): DOMPointReadOnly {
    const transform = this.zoomController.currentTransform;
    return new DOMPoint(
      transform.invertX(e.offsetX),
      transform.invertY(e.offsetY),
    );
  }

  private setInteractionState(state: BboxInteractionState): void {
    this.jotaiStore.set(this.interactionBaseAtom, state);
  }

  public renderSVG(): JSX.Element | null {
    const selectedNodes = useAtomValue(this.selectionStore.selectedNodesAtom);
    const interactionState = useAtomValue(this.interactionBaseAtom);
    if (selectedNodes.length !== 1) return null;
    const node = selectedNodes[0];
    if (!this.isEditableBboxNode(node)) return null;

    const rect = interactionState.previewRect ?? this.nodeToRect(node);
    const handleSize = this.handleSizeSceneUnits();
    const strokeWidth = "calc(var(--scene-screen-pixel) * 2)";
    const handles = this.getHandles(rect);

    return (
      <>
        <rect
          x={rect.left}
          y={rect.top}
          width={rect.width}
          height={rect.height}
          fill="none"
          stroke="var(--joy-palette-warning-400)"
          strokeWidth={strokeWidth}
          strokeDasharray={
            interactionState.activeAction === null ? "none" : "8 5"
          }
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        {handles.map((handle) => (
          <rect
            key={handle.action}
            x={handle.x - handleSize / 2}
            y={handle.y - handleSize / 2}
            width={handleSize}
            height={handleSize}
            fill="var(--joy-palette-warning-400)"
            stroke="black"
            strokeWidth="var(--scene-screen-pixel)"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ))}
      </>
    );
  }
}
