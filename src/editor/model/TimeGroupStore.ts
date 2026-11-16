import { atom, Atom, PrimitiveAtom } from "jotai";
import { Node } from "../../mung/Node";
import {
  collectTimeGroups,
  checkTimeGroupCoverage,
  isNotehead,
  readTimeGroupMetadata,
  TimeGroup,
  TimeGroupCoverageReport,
  TimeGroupMetadata,
  TimeGroupPatch,
  TimeGroupProvenance,
  timeGroupDataItem,
  timeGroupKey,
} from "../../mung/TimeGroups";
import { JotaiStore } from "./JotaiStore";
import { NotationGraphStore } from "./notation-graph-store/NotationGraphStore";
import { SelectionStore } from "./SelectionStore";

/** A prospective addition never moves a note out of its other time groups. */
export type TimeGroupSelectionOption = {
  group: TimeGroup;
  selectedMemberIds: readonly number[];
  newMemberIds: readonly number[];
  conflictingMemberIds: readonly number[];
  conflictingGroups: readonly TimeGroup[];
};

export type TimeGroupSelectionAnalysis = {
  selectedNoteheadIds: readonly number[];
  exactMatches: readonly TimeGroup[];
  overlapGroups: readonly TimeGroup[];
  overlappingNoteheadIds: readonly number[];
  ungroupedNoteheadIds: readonly number[];
  groupOptions: readonly TimeGroupSelectionOption[];
};

export type TimeGroupOverlapOptions = { allowOverlap?: boolean };
export type TimeGroupMergeOptions = TimeGroupOverlapOptions & {
  includeSelected?: boolean;
};

function analyzeSelection(
  selectedNoteheadIds: readonly number[],
  groups: readonly TimeGroup[],
): TimeGroupSelectionAnalysis {
  const selected = new Set(selectedNoteheadIds);
  const memberships = new Map<number, TimeGroup[]>();
  for (const group of groups) {
    for (const id of group.memberIds) {
      const containing = memberships.get(id) ?? [];
      containing.push(group);
      memberships.set(id, containing);
    }
  }
  return {
    selectedNoteheadIds,
    exactMatches: groups.filter(
      (group) =>
        selected.size > 0 &&
        group.memberIds.length === selected.size &&
        group.memberIds.every((id) => selected.has(id)),
    ),
    overlapGroups: groups.filter((group) =>
      group.memberIds.some((id) => selected.has(id)),
    ),
    overlappingNoteheadIds: selectedNoteheadIds.filter((id) =>
      memberships.has(id),
    ),
    ungroupedNoteheadIds: selectedNoteheadIds.filter(
      (id) => !memberships.has(id),
    ),
    groupOptions: groups.map((group) => {
      const members = new Set(group.memberIds);
      const newMemberIds = selectedNoteheadIds.filter((id) => !members.has(id));
      const conflictingGroups = new Map<string, TimeGroup>();
      const conflictingMemberIds = newMemberIds.filter((id) => {
        const otherGroups = memberships.get(id) ?? [];
        for (const otherGroup of otherGroups) {
          conflictingGroups.set(otherGroup.id, otherGroup);
        }
        return otherGroups.length > 0;
      });
      return {
        group,
        selectedMemberIds: selectedNoteheadIds.filter((id) => members.has(id)),
        newMemberIds,
        conflictingMemberIds,
        conflictingGroups: [...conflictingGroups.values()],
      };
    }),
  };
}

/** Result of inserting the groups returned by the time-group model. */
export type PredictedTimeGroupSummary = {
  createdGroups: number;
  skippedNoteheads: number;
};

/**
 * Annotation of shared musical moments. Groups are created by annotators or
 * proposed by the time-group model (provenance "predicted").
 */
export class TimeGroupStore {
  private readonly revisionAtom = atom(0);
  private notificationScheduled = false;
  public readonly activeGroupIdAtom: PrimitiveAtom<string | null> = atom<
    string | null
  >(null);
  public readonly showGroupsAtom: PrimitiveAtom<boolean> = atom(true);
  public readonly showAllGroupLabelsAtom: PrimitiveAtom<boolean> = atom(false);

  public readonly groupsAtom: Atom<readonly TimeGroup[]> = atom((get) => {
    get(this.revisionAtom);
    return collectTimeGroups(this.graph.nodes);
  });

  public readonly selectedNoteheadsAtom: Atom<readonly Node[]> = atom((get) =>
    get(this.selection.selectedNodesAtom).filter(isNotehead),
  );

  /** Include explicitly selected members even after their class is corrected. */
  public readonly selectedGroupedMembersAtom: Atom<readonly Node[]> = atom(
    (get) => {
      const groupedIds = new Set(
        get(this.groupsAtom).flatMap((group) => [...group.memberIds]),
      );
      const selectedById = new Map(
        get(this.selection.selectedNodesAtom).map((node) => [node.id, node]),
      );
      return [...selectedById.values()].filter((node) =>
        groupedIds.has(node.id),
      );
    },
  );

  public readonly selectionAnalysisAtom: Atom<TimeGroupSelectionAnalysis> =
    atom((get) =>
      analyzeSelection(
        get(this.selectedNoteheadsAtom).map((node) => node.id),
        get(this.groupsAtom),
      ),
    );

  public readonly coverageReportAtom: Atom<TimeGroupCoverageReport> = atom(
    (get) => {
      get(this.revisionAtom);
      return checkTimeGroupCoverage(this.graph.nodes);
    },
  );

  public readonly coverageAtom: Atom<{
    total: number;
    grouped: number;
    ungrouped: number;
  }> = atom((get) => {
    const report = get(this.coverageReportAtom);
    return {
      total: report.totalNoteheads,
      grouped: report.groupedNoteheads,
      ungrouped: report.ungroupedNodeIds.length,
    };
  });

  public readonly malformedCountAtom = atom((get) => {
    return get(this.coverageReportAtom).malformedRecords;
  });

  constructor(
    private readonly graph: NotationGraphStore,
    private readonly selection: SelectionStore,
    private readonly jotai: JotaiStore,
  ) {
    this.graph.onChange.subscribe(() => this.scheduleNotification());
  }

  private scheduleNotification(): void {
    if (this.notificationScheduled) return;
    this.notificationScheduled = true;
    queueMicrotask(() => {
      this.notificationScheduled = false;
      this.jotai.set(this.revisionAtom, (value) => value + 1);
      const active = this.jotai.get(this.activeGroupIdAtom);
      if (
        active !== null &&
        !this.groups.some((group) => group.id === active)
      ) {
        this.jotai.set(this.activeGroupIdAtom, null);
      }
    });
  }

  private get groups(): readonly TimeGroup[] {
    // Mutations use the live graph even before the next React notification.
    return collectTimeGroups(this.graph.nodes);
  }

  private requireGroup(id: string): TimeGroup {
    const group = this.groups.find((candidate) => candidate.id === id);
    if (!group) throw new Error("This time group no longer exists.");
    return group;
  }

  private metadata(group: TimeGroup): TimeGroupMetadata {
    return {
      version: 1,
      label: group.label,
      kind: "shared-time",
      provenance: group.provenance,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }

  private nextMetadata(
    provenance: TimeGroupProvenance = "manual",
    reservedLabels: ReadonlySet<string> = new Set(),
  ): TimeGroupMetadata {
    const labels = new Set(this.groups.map((group) => group.label));
    let number = 1;
    while (
      labels.has(`Group ${number}`) ||
      reservedLabels.has(`Group ${number}`)
    )
      number++;
    const now = new Date().toISOString();
    return {
      version: 1,
      label: `Group ${number}`,
      kind: "shared-time",
      provenance,
      createdAt: now,
      updatedAt: now,
    };
  }

  private selectedNoteIds(): number[] {
    return this.selection.selectedNodeIds.filter(
      (id) => this.graph.hasNode(id) && isNotehead(this.graph.getNode(id)),
    );
  }

  private protectUnknownRecords(patches: readonly TimeGroupPatch[]): void {
    for (const patch of patches) {
      for (const key of Object.keys(patch.data)) {
        const existing = this.graph.getNode(patch.nodeId).data[key];
        if (
          existing !== undefined &&
          readTimeGroupMetadata(existing) === null
        ) {
          throw new Error(
            "This action would change an invalid or unsupported group record. " +
              "The document was left unchanged; resolve that record before editing these memberships.",
          );
        }
      }
    }
  }

  /** Live classification also protects actions before the next UI notification. */
  public classifySelection(): TimeGroupSelectionAnalysis {
    return analyzeSelection(this.selectedNoteIds(), this.groups);
  }

  public createFromSelection(
    options: TimeGroupOverlapOptions = {},
  ): string | null {
    const analysis = this.classifySelection();
    const members = analysis.selectedNoteheadIds;
    if (members.length === 0) return null;
    if (analysis.exactMatches.length > 1) {
      throw new Error(
        "These notes match more than one existing group. Choose the group to edit; the document was left unchanged.",
      );
    }
    if (analysis.exactMatches.length === 1) {
      const existing = analysis.exactMatches[0];
      this.selectGroup(existing.id);
      return existing.id;
    }
    if (analysis.overlapGroups.length > 0 && !options.allowOverlap) {
      throw new Error(
        "Some selected notes already belong to a group. Add them to an existing group, merge groups, or explicitly create an overlapping group. The document was left unchanged.",
      );
    }
    const id = crypto.randomUUID();
    const key = timeGroupKey(id);
    const value = timeGroupDataItem(this.nextMetadata());
    this.graph.applyTimeGroupPatches(
      members.map((nodeId) => ({ nodeId, data: { [key]: value } })),
    );
    this.selectGroup(id);
    return id;
  }

  /**
   * Insert groups proposed by the time-group model in one undoable edit.
   * Each proposal lists node ids; only existing noteheads that are not in any
   * group yet become members, so manual groups are never changed. Proposals
   * left without members are dropped.
   */
  public addPredictedGroups(
    proposals: readonly (readonly number[])[],
  ): PredictedTimeGroupSummary {
    const grouped = new Set(
      this.groups.flatMap((group) => [...group.memberIds]),
    );
    const used = new Set<number>();
    const labels = new Set<string>();
    const patches: TimeGroupPatch[] = [];
    let createdGroups = 0;
    let skippedNoteheads = 0;
    for (const proposal of proposals) {
      const members: number[] = [];
      for (const nodeId of proposal) {
        if (used.has(nodeId) || !this.graph.hasNode(nodeId)) continue;
        if (!isNotehead(this.graph.getNode(nodeId))) continue;
        if (grouped.has(nodeId)) {
          skippedNoteheads++;
          continue;
        }
        used.add(nodeId);
        members.push(nodeId);
      }
      if (members.length === 0) continue;
      const metadata = this.nextMetadata("predicted", labels);
      labels.add(metadata.label);
      const key = timeGroupKey(crypto.randomUUID());
      const value = timeGroupDataItem(metadata);
      for (const nodeId of members) {
        patches.push({ nodeId, data: { [key]: value } });
      }
      createdGroups++;
    }
    if (patches.length > 0) {
      this.graph.applyTimeGroupPatches(patches);
    }
    return { createdGroups, skippedNoteheads };
  }

  /** Selecting a group never selects music nodes for destructive Delete. */
  public selectGroup(id: string): void {
    this.requireGroup(id);
    this.jotai.set(this.activeGroupIdAtom, id);
    this.jotai.set(this.showGroupsAtom, true);
    this.selection.clearSelection();
  }

  /** Finishing changes only editing focus, not memberships or save state. */
  public finishEditing(): void {
    this.jotai.set(this.activeGroupIdAtom, null);
    this.selection.clearSelection();
  }

  public renameGroup(id: string, label: string): void {
    const group = this.requireGroup(id);
    const normalized = label.trim();
    if (!normalized) throw new Error("Enter a group name.");
    if (normalized.length > 80) {
      throw new Error("Group names can contain at most 80 characters.");
    }
    if (normalized === group.label) return;
    // Ensure an edit is newer even when two actions occur within one ms.
    const updatedAt = new Date(
      Math.max(Date.now(), Date.parse(group.updatedAt) + 1),
    ).toISOString();
    const value = timeGroupDataItem({
      ...this.metadata(group),
      label: normalized,
      updatedAt,
    });
    this.graph.applyTimeGroupPatches(
      group.memberIds.map((nodeId) => ({
        nodeId,
        data: { [timeGroupKey(id)]: value },
      })),
    );
  }

  public addSelected(id: string, options: TimeGroupOverlapOptions = {}): void {
    const group = this.requireGroup(id);
    const addition = this.classifySelection().groupOptions.find(
      (candidate) => candidate.group.id === id,
    )!;
    const value = timeGroupDataItem(this.metadata(group));
    const patches = addition.newMemberIds.map((nodeId) => ({
      nodeId,
      data: { [timeGroupKey(id)]: value },
    }));
    this.protectUnknownRecords(patches);
    if (addition.conflictingMemberIds.length > 0 && !options.allowOverlap) {
      throw new Error(
        "Some new members already belong to another group. Confirm keeping those memberships before adding them here. The document was left unchanged.",
      );
    }
    this.graph.applyTimeGroupPatches(patches);
  }

  public removeSelected(id: string): void {
    const group = this.requireGroup(id);
    const selected = new Set(this.selection.selectedNodeIds);
    if (!group.memberIds.some((nodeId) => selected.has(nodeId))) return;
    const value = timeGroupDataItem(this.metadata(group));
    this.graph.applyTimeGroupPatches(
      group.memberIds.map((nodeId) => ({
        nodeId,
        // Retain the current shared label if its most recently edited member
        // leaves the group after a collaborator added a stale-label member.
        data: { [timeGroupKey(id)]: selected.has(nodeId) ? null : value },
      })),
    );
  }

  /** Remove every valid membership of the live selection in one undoable edit. */
  public removeSelectedFromAllGroups(): number {
    const selected = new Set(this.selection.selectedNodeIds);
    const removedMemberIds = new Set<number>();
    const patches = new Map<number, TimeGroupPatch>();
    for (const group of this.groups) {
      if (!group.memberIds.some((nodeId) => selected.has(nodeId))) continue;
      const key = timeGroupKey(group.id);
      const value = timeGroupDataItem(this.metadata(group));
      for (const nodeId of group.memberIds) {
        const removing = selected.has(nodeId);
        if (removing) removedMemberIds.add(nodeId);
        patches.set(nodeId, {
          nodeId,
          data: {
            ...patches.get(nodeId)?.data,
            // Carry the resolved label to survivors before its newest copy leaves.
            [key]: removing ? null : value,
          },
        });
      }
    }
    if (patches.size > 0) {
      this.graph.applyTimeGroupPatches([...patches.values()]);
    }
    return removedMemberIds.size;
  }

  public splitSelected(id: string): string | null {
    const group = this.requireGroup(id);
    const selected = new Set(this.selection.selectedNodeIds);
    const members = group.memberIds.filter((nodeId) => selected.has(nodeId));
    if (members.length === 0 || members.length === group.memberIds.length) {
      return null;
    }
    const nextId = crypto.randomUUID();
    const value = timeGroupDataItem(this.nextMetadata());
    const existingValue = timeGroupDataItem(this.metadata(group));
    this.graph.applyTimeGroupPatches(
      group.memberIds.map(
        (nodeId): TimeGroupPatch =>
          selected.has(nodeId)
            ? {
                nodeId,
                data: {
                  [timeGroupKey(id)]: null,
                  [timeGroupKey(nextId)]: value,
                },
              }
            : { nodeId, data: { [timeGroupKey(id)]: existingValue } },
      ),
    );
    this.selectGroup(nextId);
    return nextId;
  }

  public mergeGroups(
    ids: readonly string[],
    options: TimeGroupMergeOptions = {},
  ): string | null {
    const unique = [...new Set(ids)];
    if (unique.length < 2) return null;
    const groups = unique.map((id) => this.requireGroup(id));
    const target = groups[0];
    const members = new Set(groups.flatMap((group) => [...group.memberIds]));
    if (options.includeSelected) {
      const newMembers = this.selectedNoteIds().filter(
        (id) => !members.has(id),
      );
      const outsideGroups = this.groups.filter(
        (group) => !unique.includes(group.id),
      );
      if (
        !options.allowOverlap &&
        outsideGroups.some((group) =>
          group.memberIds.some((id) => newMembers.includes(id)),
        )
      ) {
        throw new Error(
          "Some selected notes belong to groups outside this merge. Include those groups or confirm keeping their memberships. The document was left unchanged.",
        );
      }
      for (const id of newMembers) members.add(id);
    }
    const value = timeGroupDataItem(this.metadata(target));
    const patches: TimeGroupPatch[] = [...members].map((nodeId) => {
      const data: Record<string, ReturnType<typeof timeGroupDataItem> | null> =
        {};
      for (const group of groups) {
        if (group.id !== target.id) data[timeGroupKey(group.id)] = null;
      }
      data[timeGroupKey(target.id)] = value;
      return { nodeId, data };
    });
    this.protectUnknownRecords(patches);
    this.graph.applyTimeGroupPatches(patches);
    this.selectGroup(target.id);
    return target.id;
  }

  public deleteGroup(id: string): void {
    const group = this.requireGroup(id);
    this.graph.applyTimeGroupPatches(
      group.memberIds.map((nodeId) => ({
        nodeId,
        data: { [timeGroupKey(id)]: null },
      })),
    );
  }

  public selectMembers(id: string): void {
    const group = this.requireGroup(id);
    this.jotai.set(this.activeGroupIdAtom, id);
    this.selection.changeSelection([...group.memberIds]);
  }

  public selectUngrouped(): void {
    const grouped = new Set(
      this.groups.flatMap((group) => [...group.memberIds]),
    );
    this.jotai.set(this.activeGroupIdAtom, null);
    this.selection.changeSelection(
      this.graph.nodes
        .filter((node) => isNotehead(node) && !grouped.has(node.id))
        .map((node) => node.id),
    );
  }

  /** Spatial navigation is only a review aid; it does not assign musical order. */
  public selectNextUngrouped(): number | null {
    const report = checkTimeGroupCoverage(this.graph.nodes);
    const candidates = report.ungroupedNodeIds
      .map((id) => this.graph.getNode(id))
      .sort((a, b) => a.top - b.top || a.left - b.left || a.id - b.id);
    if (candidates.length === 0) return null;
    const current =
      this.selection.selectedNodeIds.length === 1
        ? candidates.findIndex(
            (node) => node.id === this.selection.selectedNodeIds[0],
          )
        : -1;
    const next = candidates[(current + 1) % candidates.length];
    this.jotai.set(this.activeGroupIdAtom, null);
    this.selection.changeSelection([next.id]);
    return next.id;
  }
}
