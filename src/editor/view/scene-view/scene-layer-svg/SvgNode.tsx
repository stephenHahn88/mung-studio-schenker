import { useAtomValue } from "jotai";
import { svgPathFromMungPolygon } from "../../../../mung/svgPathFromMungPolygon";
import { classNameToColor } from "../../../../mung/classNameToColor";
import { NodeDisplayMode } from "../../../model/EditorStateStore";
import { useDataUrlFromMask } from "./useDataUrlFromMask";
import { useContext } from "react";
import { EditorContext } from "../../../EditorContext";

export interface SvgNodeProps {
  readonly nodeId: number;
  readonly nodeDisplayMode: NodeDisplayMode;
}

export function SvgNode(props: SvgNodeProps) {
  const {
    notationGraphStore,
    selectionStore,
    classVisibilityStore,
    classCatalogStore,
  } = useContext(EditorContext);

  const node = useAtomValue(notationGraphStore.getNodeAtom(props.nodeId));

  const isSelected = useAtomValue(
    selectionStore.getIsNodeSelectedAtom(props.nodeId),
  );
  const isUncertainOnly = useAtomValue(
    classVisibilityStore.isUncertainOnlyAtom,
  );
  const isNoteheadsOnly = useAtomValue(
    classVisibilityStore.isNoteheadsOnlyAtom,
  );
  const isVisible =
    useAtomValue(classVisibilityStore.getIsClassVisibleAtom(node.className)) ||
    (isSelected && !isUncertainOnly && !isNoteheadsOnly); // strict focus views also hide selected nodes

  // decide on how to display
  const colorOverrides = useAtomValue(
    classCatalogStore.classColorOverridesAtom,
  );
  const color = classNameToColor(node.className, colorOverrides);

  // data URL that displays the mask
  const maskDataUrl = useDataUrlFromMask(node, color);

  // decide on what to display
  const displayPolygon =
    props.nodeDisplayMode === NodeDisplayMode.PolygonsAndMasks &&
    node.polygon &&
    isVisible;
  const displayMask =
    maskDataUrl !== undefined &&
    !displayPolygon &&
    props.nodeDisplayMode === NodeDisplayMode.PolygonsAndMasks &&
    node.decodedMask &&
    isVisible;
  const displayBbox = !displayPolygon && !displayMask && isVisible;

  return (
    <>
      {/* Polygon */}
      {displayPolygon && (
        <path
          d={svgPathFromMungPolygon(node)}
          fill={`${color}33`}
          stroke={isSelected ? "white" : color}
          strokeWidth={isSelected ? "var(--scene-screen-pixel)" : "0"}
        />
      )}

      {/* Mask */}
      {displayMask && (
        <>
          <image
            x={node.left}
            y={node.top}
            width={node.width}
            height={node.height}
            href={maskDataUrl}
            style={{
              filter: `opacity(0.2)`,
              imageRendering: "pixelated",
            }}
          />
          <rect
            x={node.left}
            y={node.top}
            width={node.width}
            height={node.height}
            fill="none"
            stroke={isSelected ? "white" : color}
            strokeWidth={isSelected ? "var(--scene-screen-pixel)" : "0"}
          />
        </>
      )}

      {/* Bbox */}
      {displayBbox && (
        <rect
          x={node.left}
          y={node.top}
          width={node.width}
          height={node.height}
          fill={`${color}33`}
          stroke={isSelected ? "white" : color}
          strokeWidth={isSelected ? "var(--scene-screen-pixel)" : "0"}
        />
      )}
    </>
  );
}
