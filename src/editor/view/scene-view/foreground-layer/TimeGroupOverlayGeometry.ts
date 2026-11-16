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
  /** Boxes that handles and labels must not cover. */
  readonly extraObstacles?: readonly TimeGroupDisplayBounds[];
  /** Groups whose labels are shown (all when omitted). */
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

/** Splits a group label into lines. */
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
 * Places the rail, handle and label of each group. Sizes are in screen pixels.
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

    // groups sharing notes get adjacent rails
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

    // keep the handle clear of member markers
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
            // upper bound of the label width at 11px per character
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
  // labels are placed after all handles
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
