import { useCallback, useContext, useEffect, useRef } from "react";
import { Node } from "../../../mung/Node";
import {
  classNameToColor,
  ClassColorOverrides,
} from "../../../mung/classNameToColor";
import { EditorContext } from "../../EditorContext";
import { SelectionNodeChangeMetadata } from "../../model/SelectionStore";
import { useAtomValue } from "jotai";

/**
 * Scene layer, rendered via canvas 2D
 */
export function SceneLayer_Canvas2D() {
  const {
    notationGraphStore,
    selectionStore,
    zoomController,
    classVisibilityStore,
    classCatalogStore,
  } = useContext(EditorContext);
  const colorOverrides = useAtomValue(
    classCatalogStore.classColorOverridesAtom,
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);

  const draw = useCallback(() => {
    const ctx = canvasContextRef.current;
    if (ctx === null) return;

    const nodes = notationGraphStore.nodes.filter((node) =>
      classVisibilityStore.visibleClasses.has(node.className),
    );
    renderToCanvas(nodes, ctx, zoomController.currentTransform, colorOverrides);
  }, [
    classVisibilityStore,
    notationGraphStore,
    zoomController,
    colorOverrides,
  ]);

  useEffect(() => {
    if (canvasRef.current === null) return;
    canvasContextRef.current = canvasRef.current.getContext("2d");

    const onZoom = (transform: d3.ZoomTransform) => draw();
    const onSelectionChange = (meta: SelectionNodeChangeMetadata) => draw();
    const onGraphChange = () => draw();
    const onClassVisibilityChange = () => draw();

    // also draw immediately when mounted
    draw();

    zoomController.onTransformChange.subscribe(onZoom);
    selectionStore.onNodesChange.subscribe(onSelectionChange);
    notationGraphStore.onChange.subscribe(onGraphChange);
    classVisibilityStore.onChange.subscribe(onClassVisibilityChange);
    return () => {
      zoomController.onTransformChange.unsubscribe(onZoom);
      selectionStore.onNodesChange.unsubscribe(onSelectionChange);
      notationGraphStore.onChange.unsubscribe(onGraphChange);
      classVisibilityStore.onChange.unsubscribe(onClassVisibilityChange);
    };
  }, [
    classVisibilityStore,
    draw,
    notationGraphStore,
    selectionStore,
    zoomController,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    ></canvas>
  );
}

function renderToCanvas(
  nodes: readonly Node[],
  ctx: CanvasRenderingContext2D,
  t: d3.ZoomTransform,
  colorOverrides: ClassColorOverrides,
) {
  // resize canvas frame buffer if necessary
  if (ctx.canvas.width != ctx.canvas.clientWidth) {
    ctx.canvas.width = ctx.canvas.clientWidth;
  }
  if (ctx.canvas.height != ctx.canvas.clientHeight) {
    ctx.canvas.height = ctx.canvas.clientHeight;
  }

  // reset transform back to pixel space
  ctx.resetTransform();

  // clear the frame buffer
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // set the viewport transform
  ctx.translate(t.x, t.y);
  ctx.scale(t.k, t.k);

  // render nodes
  for (const node of nodes) {
    ctx.fillStyle = `${classNameToColor(node.className, colorOverrides)}33`;

    // bbox
    ctx.fillRect(node.left, node.top, node.width, node.height);

    // polygon
    fillPolygon(ctx, node);
  }
}

function fillPolygon(ctx: CanvasRenderingContext2D, node: Node) {
  const polygon = node.polygon;

  if (polygon === null) {
    return;
  }

  ctx.beginPath();
  let i = 0;

  ctx.moveTo(polygon[i], polygon[i + 1]);
  i += 2;

  while (i < polygon.length) {
    ctx.lineTo(polygon[i], polygon[i + 1]);
    i += 2;
  }

  ctx.closePath();
  ctx.fill();
}
