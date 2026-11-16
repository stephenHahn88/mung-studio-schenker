import type { Node } from "../../../../mung/Node";
import type { TimeGroup } from "../../../../mung/TimeGroups";
import {
  timeGroupMemberBounds,
  type TimeGroupDisplayBounds,
  type TimeGroupMemberMarker,
} from "./TimeGroupMemberMarkers";

type Member = Pick<Node, "id" | "left" | "top" | "width" | "height">;
export interface TimeGroupOverlayInput {
  readonly group: TimeGroup;
  readonly members: readonly Member[];
}
export interface TimeGroupOverlayGeometry extends TimeGroupOverlayInput {
  readonly railX: number;
  readonly markerY: number;
  readonly railBottom: number;
  readonly labelX: number;
  readonly labelTop: number;
  readonly labelWidth: number;
  readonly labelHeight: number;
  readonly labelLines: readonly string[];
  readonly labelVisible: boolean;
}

export interface TimeGroupOverlayLayoutOptions {
  readonly memberMarkers?: readonly TimeGroupMemberMarker[];
  /** Annotation bboxes that handles/labels must not cover, including ungrouped notes. */
  readonly extraObstacles?: readonly TimeGroupDisplayBounds[];
  /** Omit for all labels. An empty set draws none, leaving every diamond. */
  readonly visibleLabelIds?: ReadonlySet<string>;
}

function intersects(
  a: TimeGroupDisplayBounds,
  b: TimeGroupDisplayBounds,
): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

/** Wrap the complete user label, including long words and CJK text. */
export function wrapTimeGroupLabel(label: string): readonly string[] {
  const lines: string[] = [];
  let line: string[] = [];
  let units = 0;
  const characterUnits = (character: string) =>
    /[^\u0000-\u00ff]/u.test(character) ? 2 : 1;
  for (const character of Array.from(label)) {
    const nextUnits = characterUnits(character);
    if (units + nextUnits > 26 && line.length) {
      const lastSpace = line.lastIndexOf(" ");
      const split = lastSpace > 0 ? lastSpace + 1 : line.length;
      lines.push(line.slice(0, split).join(""));
      line = line.slice(split);
      units = line.reduce((sum, item) => sum + characterUnits(item), 0);
    }
    line.push(character);
    units += nextUnits;
  }
  if (line.length) lines.push(line.join(""));
  return lines.length ? lines : [""];
}

/**
 * Display-only layout. Rails connect actual member coordinates; their positions
 * and the order in which labels are placed express no musical time or depth.
 * All annotation dimensions remain constant in screen pixels as the page zooms.
 */
export function layoutTimeGroupOverlays(
  inputs: readonly TimeGroupOverlayInput[],
  scale: number,
  options: TimeGroupOverlayLayoutOptions = {},
): readonly TimeGroupOverlayGeometry[] {
  const pixel = 1 / Math.max(Number.isFinite(scale) ? scale : 1, 0.001);
  const markerBounds = new Map(
    (options.memberMarkers ?? []).map((marker) => [
      marker.nodeId,
      timeGroupMemberBounds(marker),
    ]),
  );
  const obstacles = [
    ...markerBounds.values(),
    ...(options.extraObstacles ?? []),
  ];
  const placed: TimeGroupOverlayGeometry[] = [];
  for (const { group, members } of inputs) {
    if (members.length === 0) continue;
    const centers = members.map((member) => member.top + member.height / 2);
    const firstY = Math.min(...centers);
    const lastY = Math.max(...centers);
    let railX = Math.min(...members.map((member) => member.left)) - 18 * pixel;
    let markerY = firstY - 20 * pixel;
    for (const member of members) {
      const bounds = markerBounds.get(member.id);
      if (!bounds) continue;
      railX = Math.min(railX, bounds.left - 12 * pixel);
      markerY = Math.min(markerY, bounds.top - 12 * pixel);
    }

    // A second group sharing notes gets its own adjacent rail, instead of
    // concealing the first group's marker or implying a second note position.
    while (
      placed.some(
        (other) =>
          Math.abs(railX - other.railX) < 12 * pixel &&
          markerY <= other.railBottom + 8 * pixel &&
          lastY >= other.markerY - 8 * pixel,
      )
    ) {
      railX -= 14 * pixel;
    }

    // Keep the small diamond target clear of every member ring/badge. The
    // diamond and rail never move merely because a group becomes active.
    let markerCollision: TimeGroupDisplayBounds | undefined;
    while (
      (markerCollision = obstacles.find((bounds) =>
        intersects(
          {
            left: railX - 9 * pixel,
            right: railX + 9 * pixel,
            top: markerY - 9 * pixel,
            bottom: markerY + 9 * pixel,
          },
          bounds,
        ),
      ))
    ) {
      markerY = markerCollision.top - 12 * pixel;
    }

    const labelLines = wrapTimeGroupLabel(group.label);
    const labelWidth =
      Math.max(
        ...labelLines.map(
          (line) =>
            // Conservative width at 11px includes wide Latin letters and CJK;
            // actual text is rendered at its normal width, never stretched.
            Array.from(line).length * 11,
        ),
      ) * pixel;
    const labelX = railX + 13 * pixel;
    const labelHeight = labelLines.length * 14 * pixel;
    const labelTop = markerY + 7 * pixel - labelHeight;
    const labelVisible = options.visibleLabelIds?.has(group.id) ?? true;

    placed.push({
      group,
      members,
      railX,
      markerY,
      railBottom: lastY,
      labelX,
      labelTop,
      labelWidth,
      labelHeight,
      labelLines,
      labelVisible,
    });
  }
  // Place labels after all diamonds are known so no label hides another
  // group's clickable target. Hidden labels reserve no page space.
  const labelObstacles = [
    ...obstacles,
    ...placed.map((other) => ({
      left: other.railX - 9 * pixel,
      right: other.railX + 9 * pixel,
      top: other.markerY - 9 * pixel,
      bottom: other.markerY + 9 * pixel,
    })),
  ];
  return placed.map((layout) => {
    if (!layout.labelVisible) return layout;
    let labelTop = layout.labelTop;
    const bounds = () => ({
      left: layout.labelX - 4 * pixel,
      right: layout.labelX + layout.labelWidth + 4 * pixel,
      top: labelTop - 3 * pixel,
      bottom: labelTop + layout.labelHeight + 3 * pixel,
    });
    let collision: TimeGroupDisplayBounds | undefined;
    while (
      (collision = labelObstacles.find((other) => intersects(bounds(), other)))
    ) {
      labelTop = collision.top - layout.labelHeight - 7 * pixel;
    }
    labelObstacles.push(bounds());
    return { ...layout, labelTop };
  });
}
