import { useContext, useState } from "react";
import { useAtomValue } from "jotai";
import { EditorContext } from "../../EditorContext";
import { UNCERTAIN_CLASS_NAME } from "../../../mung/ontology/mungClasses";

/** Cursors and selections of the other collaborators. */
export function CollabOverlay() {
  const {
    collabController,
    zoomController,
    notationGraphStore,
    classVisibilityStore,
  } = useContext(EditorContext);
  const peers = useAtomValue(collabController!.peersAtom);
  const isUncertainOnly = useAtomValue(
    classVisibilityStore.isUncertainOnlyAtom,
  );

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

        // selection: outline of each selected node
        for (const nodeId of peer.selection ?? []) {
          if (!notationGraphStore.hasNode(nodeId)) continue;
          const n = notationGraphStore.getNode(nodeId);
          if (isUncertainOnly && n.className !== UNCERTAIN_CLASS_NAME) {
            continue;
          }
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

        // cursor: arrow and name
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
