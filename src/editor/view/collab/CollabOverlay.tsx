import { useContext, useState } from "react";
import { useAtomValue } from "jotai";
import { EditorContext } from "../../EditorContext";

/**
 * Transparent, click-through overlay that draws every collaborator's live
 * cursor and their current selection, mapped through the scene's zoom/pan
 * transform so they stay pinned to the document as you navigate.
 *
 * Mounted inside the SceneView container (which is position:relative and fills
 * the viewport), so screen coordinates here match the d3 zoom transform.
 */
export function CollabOverlay() {
  const { collabController, zoomController, notationGraphStore } =
    useContext(EditorContext);
  const peers = useAtomValue(collabController!.peersAtom);

  // re-render whenever the view is panned/zoomed
  const [tick, setTick] = useState(0);
  zoomController.useOnTransformChange(() => setTick((t) => t + 1), []);
  void tick;
  const transform: any = zoomController.currentTransform;

  const toScreen = (x: number, y: number): [number, number] =>
    transform.apply([x, y]);

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
        zIndex: 20,
      }}
    >
      {peers.map((peer) => {
        const els: React.ReactNode[] = [];

        // --- peer selection: outline each selected node's bbox ---
        for (const nodeId of peer.selection ?? []) {
          if (!notationGraphStore.hasNode(nodeId)) continue;
          const n = notationGraphStore.getNode(nodeId);
          const [x0, y0] = toScreen(n.left, n.top);
          const [x1, y1] = toScreen(n.left + n.width, n.top + n.height);
          els.push(
            <rect
              key={`sel-${nodeId}`}
              x={Math.min(x0, x1) - 2}
              y={Math.min(y0, y1) - 2}
              width={Math.abs(x1 - x0) + 4}
              height={Math.abs(y1 - y0) + 4}
              fill={peer.color}
              fillOpacity={0.1}
              stroke={peer.color}
              strokeWidth={2}
              rx={2}
            />,
          );
        }

        // --- peer cursor: arrow + name label ---
        if (peer.cursor) {
          const [cx, cy] = toScreen(peer.cursor.x, peer.cursor.y);
          els.push(
            <g key="cursor" transform={`translate(${cx}, ${cy})`}>
              <path
                d="M0,0 L0,16 L4.5,12 L7.5,18 L10,17 L7,11 L13,11 Z"
                fill={peer.color}
                stroke="#fff"
                strokeWidth={1}
              />
              <g transform="translate(14, 10)">
                <rect
                  x={0}
                  y={0}
                  rx={4}
                  height={18}
                  width={peer.name.length * 7 + 12}
                  fill={peer.color}
                />
                <text
                  x={6}
                  y={13}
                  fill="#fff"
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="system-ui, sans-serif"
                >
                  {peer.name}
                </text>
              </g>
            </g>,
          );
        }

        return <g key={peer.clientId}>{els}</g>;
      })}
    </svg>
  );
}
