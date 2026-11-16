import {
  useContext,
  useEffect,
  useRef,
  useState,
  type SVGProps,
  type SyntheticEvent,
} from "react";
import { useAtomValue } from "jotai";
import { EditorContext } from "../../../EditorContext";
import { PageImageMode } from "../../../model/EditorStateStore";
import { layoutTimeGroupOverlays } from "./TimeGroupOverlayGeometry";
import {
  layoutTimeGroupMemberMarkers,
  TIME_GROUP_MEMBER_COLORS,
  TIME_GROUP_MEMBER_STROKES,
} from "./TimeGroupMemberMarkers";

/** Time-group rails, handles, labels and member markers on the page. */
export function TimeGroupsOverlay() {
  const {
    timeGroupStore,
    notationGraphStore,
    zoomController,
    editorStateStore,
  } = useContext(EditorContext);
  const groups = useAtomValue(timeGroupStore.groupsAtom);
  const activeId = useAtomValue(timeGroupStore.activeGroupIdAtom);
  const showGroups = useAtomValue(timeGroupStore.showGroupsAtom);
  const showAllLabels = useAtomValue(timeGroupStore.showAllGroupLabelsAtom);
  const pageImageMode = useAtomValue(editorStateStore.pageImageModeAtom);
  const readOnlyView = pageImageMode === PageImageMode.OriginalOnly;
  const [scale, setScale] = useState(zoomController.currentTransform.k);
  const handlePress = useRef<string | null>(null);
  useEffect(() => {
    const reset = () => {
      handlePress.current = null;
    };
    window.addEventListener("mousedown", reset, true);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("mousedown", reset, true);
      window.removeEventListener("blur", reset);
    };
  }, []);
  zoomController.useOnTransformChange((transform) => setScale(transform.k), []);
  if (!showGroups) return null;

  const screenPixel = 1 / Math.max(Number.isFinite(scale) ? scale : 1, 0.001);
  const inputs = groups.map((group) => ({
    group,
    members: group.memberIds
      .filter((id) => notationGraphStore.hasNode(id))
      .map((id) => notationGraphStore.getNode(id)),
  }));
  const memberMarkers = layoutTimeGroupMemberMarkers(inputs, activeId, scale);
  const layouts = layoutTimeGroupOverlays(inputs, scale, {
    memberMarkers,
    // all nodes except long connectors and staff objects
    extraObstacles: notationGraphStore.nodes
      .filter(
        (node) => !/^(?:beam|slur|tie|staff|system)/i.test(node.className),
      )
      .map((node) => ({
        left: node.left - 2 * screenPixel,
        top: node.top - 2 * screenPixel,
        right: node.left + node.width + 2 * screenPixel,
        bottom: node.top + node.height + 2 * screenPixel,
      })),
    visibleLabelIds: showAllLabels
      ? undefined
      : new Set(activeId ? [activeId] : []),
  });
  const ordered = [
    ...layouts.filter(({ group }) => group.id !== activeId),
    ...layouts.filter(({ group }) => group.id === activeId),
  ];

  // capture phase: the scene handles mouse events on the ancestor SVG
  const isolate = (event: SyntheticEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  const activationProps = (
    id: string,
    label: string,
  ): SVGProps<SVGGElement> => ({
    role: "button",
    tabIndex: readOnlyView ? -1 : 0,
    "aria-label": `Edit ${label} time group`,
    "aria-disabled": readOnlyView,
    "aria-pressed": activeId === id,
    pointerEvents: readOnlyView ? "none" : "all",
    style: { cursor: readOnlyView ? "default" : "pointer" },
    onMouseDownCapture: (event) => {
      if (readOnlyView || event.button !== 0) return;
      handlePress.current = id;
      isolate(event);
    },
    onMouseUpCapture: (event) => {
      if (event.button !== 0 || handlePress.current !== id) return;
      handlePress.current = null;
      isolate(event);
    },
    onPointerDownCapture: (event) => {
      if (event.button === 0) event.stopPropagation();
    },
    onTouchStartCapture: (event) => event.stopPropagation(),
    onDoubleClickCapture: isolate,
    onClickCapture: (event) => {
      isolate(event);
      if (readOnlyView || event.button !== 0) return;
      timeGroupStore.selectGroup(id);
      (document.activeElement as HTMLElement | null)?.blur();
    },
    onKeyDownCapture: (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      isolate(event);
      if (readOnlyView) return;
      timeGroupStore.selectGroup(id);
      (document.activeElement as HTMLElement | null)?.blur();
    },
    onKeyUpCapture: (event) => {
      if (event.key === "Enter" || event.key === " ") isolate(event);
    },
  });

  return (
    <g
      data-testid="time-groups-overlay"
      aria-label="Hypernode membership highlights; connectors have no direction"
      pointerEvents="none"
    >
      {ordered.map(({ group, members, railX, markerY, railBottom }) => {
        const active = group.id === activeId;
        const color = active
          ? TIME_GROUP_MEMBER_COLORS.active
          : TIME_GROUP_MEMBER_COLORS.grouped;
        const diamond = (active ? 6 : 5) * screenPixel;
        return (
          <g
            key={group.id}
            data-time-group-id={group.id}
            data-active={String(active)}
          >
            <title>
              {group.label}: {members.length} members. Shared time group;
              connectors do not represent sequential edges.
            </title>
            <path
              data-time-group-rail="true"
              d={`M ${railX} ${markerY + diamond} V ${railBottom}`}
              stroke={color}
              fill="none"
              opacity={active ? 0.95 : 0.3}
              strokeWidth={active ? 1.8 : 1}
              vectorEffect="non-scaling-stroke"
            />
            {members.map((node) => (
              <path
                key={`spoke-${node.id}`}
                data-time-group-spoke={node.id}
                d={`M ${railX} ${node.top + node.height / 2} H ${node.left + node.width / 2}`}
                fill="none"
                stroke={color}
                strokeWidth={active ? 1.4 : 0.8}
                strokeDasharray="3 4"
                opacity={active ? 0.75 : 0.2}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <g
              {...activationProps(group.id, group.label)}
              data-time-group-activate="diamond"
              data-group-id={group.id}
            >
              <rect
                x={railX - 9 * screenPixel}
                y={markerY - 9 * screenPixel}
                width={18 * screenPixel}
                height={18 * screenPixel}
                fill="transparent"
              />
              <polygon
                data-time-group-marker="diamond"
                points={`${railX},${markerY - diamond} ${railX + diamond},${markerY} ${railX},${markerY + diamond} ${railX - diamond},${markerY}`}
                fill={active ? color : "#111827"}
                stroke={color}
                strokeWidth={active ? 2 : 1.5}
                opacity={active ? 1 : 0.8}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </g>
        );
      })}
      {memberMarkers.map((marker) => {
        const color = TIME_GROUP_MEMBER_COLORS.grouped;
        const ellipse = {
          cx: marker.cx,
          cy: marker.cy,
          rx: marker.rx,
          ry: marker.ry,
          fill: "none",
        };
        const description = `${marker.notehead ? "Notehead" : "Review non-notehead member"} ${marker.nodeId}: ${marker.membershipCount} group membership${marker.membershipCount === 1 ? "" : "s"}${marker.active ? "; belongs to the active group" : ""}. Numbers count memberships only, not musical time or depth.`;
        return (
          <g
            key={marker.nodeId}
            data-time-group-member={marker.nodeId}
            data-time-group-membership-count={marker.membershipCount}
            data-time-group-member-kind={
              marker.notehead ? "notehead" : "review"
            }
            data-active={String(marker.active)}
            aria-label={description}
          >
            <title>{description}</title>
            <ellipse
              {...ellipse}
              data-time-group-member-halo="light"
              stroke={TIME_GROUP_MEMBER_COLORS.lightHalo}
              strokeWidth={TIME_GROUP_MEMBER_STROKES.lightHalo}
              vectorEffect="non-scaling-stroke"
            />
            <ellipse
              {...ellipse}
              data-time-group-member-halo="dark"
              stroke={TIME_GROUP_MEMBER_COLORS.darkHalo}
              strokeWidth={TIME_GROUP_MEMBER_STROKES.darkHalo}
              vectorEffect="non-scaling-stroke"
            />
            <ellipse
              {...ellipse}
              data-time-group-member-ring="true"
              stroke={color}
              strokeWidth={TIME_GROUP_MEMBER_STROKES.ring}
              strokeDasharray={marker.notehead ? undefined : "4 3"}
              vectorEffect="non-scaling-stroke"
            />
            {marker.badgeText && (
              <>
                <ellipse
                  data-time-group-member-badge="true"
                  cx={marker.badgeX}
                  cy={marker.badgeY}
                  rx={marker.badgeRx}
                  ry={marker.badgeRy}
                  fill={color}
                  stroke={TIME_GROUP_MEMBER_COLORS.lightHalo}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
                <ellipse
                  cx={marker.badgeX}
                  cy={marker.badgeY}
                  rx={marker.badgeRx}
                  ry={marker.badgeRy}
                  fill="none"
                  stroke={TIME_GROUP_MEMBER_COLORS.darkHalo}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  data-time-group-member-badge-text="true"
                  x={marker.badgeX}
                  y={marker.badgeY}
                  dy="0.35em"
                  textAnchor="middle"
                  fill={TIME_GROUP_MEMBER_COLORS.darkHalo}
                  fontSize={9 * screenPixel}
                  fontFamily="sans-serif"
                  fontWeight={800}
                >
                  {marker.badgeText}
                </text>
              </>
            )}
          </g>
        );
      })}
      {/* Labels are drawn last */}
      <g data-time-group-label-layer="true">
        {ordered
          .filter((layout) => layout.labelVisible)
          .map((layout) => {
            const {
              group,
              railX,
              markerY,
              labelX,
              labelTop,
              labelWidth,
              labelHeight,
              labelLines,
            } = layout;
            const active = group.id === activeId;
            const color = active
              ? TIME_GROUP_MEMBER_COLORS.active
              : TIME_GROUP_MEMBER_COLORS.grouped;
            return (
              <g key={group.id} data-time-group-label-id={group.id}>
                <path
                  data-time-group-label-leader="true"
                  d={`M ${railX} ${markerY} L ${labelX} ${labelTop + labelHeight / 2}`}
                  stroke={color}
                  strokeWidth={0.8}
                  opacity={0.45}
                  vectorEffect="non-scaling-stroke"
                />
                <g
                  {...activationProps(group.id, group.label)}
                  data-time-group-activate="label"
                  data-group-id={group.id}
                >
                  <rect
                    data-time-group-label-background="true"
                    x={labelX - 4 * screenPixel}
                    y={labelTop - 3 * screenPixel}
                    width={labelWidth + 8 * screenPixel}
                    height={labelHeight + 6 * screenPixel}
                    rx={3 * screenPixel}
                    fill="#111827"
                    fillOpacity={0.94}
                    stroke={color}
                    strokeWidth={0.7}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    data-time-group-label="true"
                    x={labelX}
                    y={labelTop + 11 * screenPixel}
                    fill={color}
                    fontSize={11 * screenPixel}
                    fontWeight={active ? 700 : 500}
                    fontFamily="sans-serif"
                  >
                    {labelLines.map((line, index) => (
                      <tspan
                        key={index}
                        x={labelX}
                        dy={index === 0 ? 0 : 14 * screenPixel}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              </g>
            );
          })}
      </g>
    </g>
  );
}
