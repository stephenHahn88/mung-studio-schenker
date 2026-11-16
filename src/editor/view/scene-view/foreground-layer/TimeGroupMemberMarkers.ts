import type { Node } from "../../../../mung/Node";
import { isNotehead, type TimeGroup } from "../../../../mung/TimeGroups";

type Member = Pick<
  Node,
  "id" | "className" | "left" | "top" | "width" | "height"
>;

export const TIME_GROUP_MEMBER_COLORS = {
  grouped: "#22c55e",
  active: "#38bdf8",
  darkHalo: "#111827",
  lightHalo: "#ffffff",
} as const;

export const TIME_GROUP_MEMBER_STROKES = {
  lightHalo: 3.4,
  darkHalo: 2.4,
  ring: 1.5,
} as const;

export interface TimeGroupDisplayBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface TimeGroupMemberInput {
  readonly group: Pick<TimeGroup, "id">;
  readonly members: readonly Member[];
}

export interface TimeGroupMemberMarker {
  readonly nodeId: number;
  readonly groupIds: readonly string[];
  readonly membershipCount: number;
  readonly active: boolean;
  readonly notehead: boolean;
  readonly badgeText: string;
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly badgeX: number;
  readonly badgeY: number;
  readonly badgeRx: number;
  readonly badgeRy: number;
  readonly screenPixel: number;
}

/**
 * One marker per group member: an ellipse around its box and a badge with the
 * number of its groups. Padding, strokes and badges are sized in screen pixels.
 */
export function layoutTimeGroupMemberMarkers(
  inputs: readonly TimeGroupMemberInput[],
  activeId: string | null,
  scale: number,
): readonly TimeGroupMemberMarker[] {
  const pixel = 1 / Math.max(Number.isFinite(scale) ? scale : 1, 0.001);
  const members = new Map<number, { node: Member; groupIds: Set<string> }>();
  for (const { group, members: groupMembers } of inputs) {
    for (const node of groupMembers) {
      const member = members.get(node.id);
      if (member) member.groupIds.add(group.id);
      else members.set(node.id, { node, groupIds: new Set([group.id]) });
    }
  }

  return [...members.values()].map(({ node, groupIds }) => {
    const notehead = isNotehead(node);
    const membershipCount = groupIds.size;
    const badgeText = notehead
      ? membershipCount > 1
        ? String(membershipCount)
        : ""
      : membershipCount > 1
        ? `!${membershipCount}`
        : "!";
    const badgeRx = Math.max(6, 3 * badgeText.length + 3) * pixel;
    return {
      nodeId: node.id,
      groupIds: [...groupIds],
      membershipCount,
      active: activeId !== null && groupIds.has(activeId),
      notehead,
      badgeText,
      cx: node.left + node.width / 2,
      cy: node.top + node.height / 2,
      // sqrt(2) makes the ellipse enclose the box corners
      rx: Math.SQRT2 * (node.width / 2 + 2.5 * pixel),
      ry: Math.SQRT2 * (node.height / 2 + 2.5 * pixel),
      badgeX: node.left + node.width + badgeRx,
      badgeY: node.top - 8 * pixel,
      badgeRx,
      badgeRy: 6 * pixel,
      screenPixel: pixel,
    };
  });
}

/** Bounds of the ellipse and badge of a marker. */
export function timeGroupMemberBounds(
  marker: TimeGroupMemberMarker,
): TimeGroupDisplayBounds {
  const halo = (TIME_GROUP_MEMBER_STROKES.lightHalo / 2) * marker.screenPixel;
  const ring = {
    left: marker.cx - marker.rx - halo,
    top: marker.cy - marker.ry - halo,
    right: marker.cx + marker.rx + halo,
    bottom: marker.cy + marker.ry + halo,
  };
  if (!marker.badgeText) return ring;
  const badgeHalo = marker.screenPixel;
  return {
    left: Math.min(ring.left, marker.badgeX - marker.badgeRx - badgeHalo),
    top: Math.min(ring.top, marker.badgeY - marker.badgeRy - badgeHalo),
    right: Math.max(ring.right, marker.badgeX + marker.badgeRx + badgeHalo),
    bottom: Math.max(ring.bottom, marker.badgeY + marker.badgeRy + badgeHalo),
  };
}
