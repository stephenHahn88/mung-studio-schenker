import { DataItems } from "./DataItems";
import { Node } from "./Node";

export const TIME_GROUP_PREFIX = "schenker_time_group_v1_";

export interface TimeGroupPatch {
  readonly nodeId: number;
  /** TIME_GROUP_PREFIX keys only; null removes the membership. */
  readonly data: Readonly<Record<string, DataItems[string] | null>>;
}

/**
 * "manual": created by an annotator; "predicted": created by the time-group
 * model.
 */
export type TimeGroupProvenance = "manual" | "predicted";

export interface TimeGroupMetadata {
  readonly version: 1;
  readonly label: string;
  readonly kind: "shared-time";
  readonly provenance: TimeGroupProvenance;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TimeGroup extends TimeGroupMetadata {
  readonly id: string;
  readonly memberIds: readonly number[];
  readonly nonNoteheadIds: readonly number[];
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface TimeGroupCoverageReport {
  readonly totalNoteheads: number;
  readonly groupedNoteheads: number;
  readonly ungroupedNodeIds: readonly number[];
  readonly overlappingNodeIds: readonly number[];
  readonly nonNoteheadMemberIds: readonly number[];
  readonly malformedRecords: number;
  readonly allNoteheadsGrouped: boolean;
}

export function isNotehead(node: Pick<Node, "className">): boolean {
  return /notehead/i.test(node.className);
}

export function isTimeGroupKey(key: string): boolean {
  return (
    key.startsWith(TIME_GROUP_PREFIX) &&
    /^[A-Za-z0-9_-]{1,100}$/.test(key.slice(TIME_GROUP_PREFIX.length))
  );
}

export function hasTimeGroupData(node: Pick<Node, "data">): boolean {
  return Object.keys(node.data).some((key) =>
    key.startsWith(TIME_GROUP_PREFIX),
  );
}

export function timeGroupKey(id: string): string {
  const key = TIME_GROUP_PREFIX + id;
  if (!isTimeGroupKey(key)) throw new Error("Invalid time group identifier.");
  return key;
}

export function readTimeGroupMetadata(
  item: DataItems[string] | undefined,
): TimeGroupMetadata | null {
  if (!item || item.type !== "str" || item.value.length > 4096) return null;
  try {
    const value = JSON.parse(item.value);
    if (
      value === null ||
      typeof value !== "object" ||
      value.version !== 1 ||
      value.kind !== "shared-time" ||
      (value.provenance !== "manual" && value.provenance !== "predicted") ||
      typeof value.label !== "string" ||
      !value.label.trim() ||
      value.label.length > 80 ||
      typeof value.createdAt !== "string" ||
      typeof value.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      !Number.isFinite(Date.parse(value.updatedAt))
    ) {
      return null;
    }
    return {
      version: 1,
      label: value.label,
      kind: "shared-time",
      provenance: value.provenance,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  } catch {
    return null;
  }
}

export function timeGroupDataItem(
  metadata: TimeGroupMetadata,
): DataItems[string] {
  return { type: "str", value: JSON.stringify(metadata) };
}

function laterMetadata(
  first: TimeGroupMetadata,
  second: TimeGroupMetadata,
): TimeGroupMetadata {
  const difference = Date.parse(second.updatedAt) - Date.parse(first.updatedAt);
  if (difference > 0) return second;
  if (difference < 0) return first;
  // equal timestamps: deterministic choice
  return JSON.stringify(second) > JSON.stringify(first) ? second : first;
}

/** Time groups read from the time-group DataItems of the nodes. */
export function collectTimeGroups(
  nodes: readonly Node[],
): readonly TimeGroup[] {
  const groups = new Map<
    string,
    { metadata: TimeGroupMetadata; members: Node[] }
  >();
  for (const node of nodes) {
    for (const [key, item] of Object.entries(node.data)) {
      if (!isTimeGroupKey(key)) continue;
      const metadata = readTimeGroupMetadata(item);
      if (metadata === null) continue;
      const id = key.slice(TIME_GROUP_PREFIX.length);
      const previous = groups.get(id);
      if (previous) {
        previous.members.push(node);
        previous.metadata = laterMetadata(previous.metadata, metadata);
      } else {
        groups.set(id, { metadata, members: [node] });
      }
    }
  }
  return [...groups.entries()]
    .map(([id, { metadata, members }]): TimeGroup => {
      const left = Math.min(...members.map((node) => node.left));
      const top = Math.min(...members.map((node) => node.top));
      const right = Math.max(...members.map((node) => node.left + node.width));
      const bottom = Math.max(...members.map((node) => node.top + node.height));
      return {
        ...metadata,
        id,
        memberIds: members.map((node) => node.id).sort((a, b) => a - b),
        nonNoteheadIds: members
          .filter((node) => !isNotehead(node))
          .map((node) => node.id)
          .sort((a, b) => a - b),
        left,
        top,
        width: right - left,
        height: bottom - top,
      };
    })
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

export function countMalformedTimeGroupItems(nodes: readonly Node[]): number {
  return nodes.reduce(
    (count, node) =>
      count +
      Object.entries(node.data).filter(
        ([key, item]) =>
          key.startsWith(TIME_GROUP_PREFIX) &&
          (!isTimeGroupKey(key) || readTimeGroupMetadata(item) === null),
      ).length,
    0,
  );
}

/** Notehead coverage of the time groups. */
export function checkTimeGroupCoverage(
  nodes: readonly Node[],
): TimeGroupCoverageReport {
  const groups = collectTimeGroups(nodes);
  const memberships = new Map<number, number>();
  const nonNoteheadMembers = new Set<number>();
  for (const group of groups) {
    for (const id of group.memberIds) {
      memberships.set(id, (memberships.get(id) ?? 0) + 1);
    }
    for (const id of group.nonNoteheadIds) nonNoteheadMembers.add(id);
  }
  const notes = nodes.filter(isNotehead);
  const sortedIds = (items: readonly Node[]) =>
    items.map((node) => node.id).sort((a, b) => a - b);
  const ungroupedNodeIds = sortedIds(
    notes.filter((node) => !memberships.has(node.id)),
  );
  return {
    totalNoteheads: notes.length,
    groupedNoteheads: notes.length - ungroupedNodeIds.length,
    ungroupedNodeIds,
    overlappingNodeIds: sortedIds(
      notes.filter((node) => (memberships.get(node.id) ?? 0) > 1),
    ),
    nonNoteheadMemberIds: [...nonNoteheadMembers].sort((a, b) => a - b),
    malformedRecords: countMalformedTimeGroupItems(nodes),
    allNoteheadsGrouped: notes.length > 0 && ungroupedNodeIds.length === 0,
  };
}
