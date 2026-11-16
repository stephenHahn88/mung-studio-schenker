import { useContext, useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormLabel,
  IconButton,
  Input,
  Stack,
  Switch,
  Typography,
} from "@mui/joy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { EditorContext } from "../../EditorContext";
import { PageImageMode } from "../../model/EditorStateStore";

type OverlapReview = {
  kind: "create" | "add";
  targetId?: string;
  selectionKey: string;
  revision: number;
};

/** Creates, edits and reviews time groups. */
export function TimeGroupsPanel() {
  const {
    timeGroupStore,
    selectionStore,
    editorStateStore,
    mainMenuController,
    classVisibilityStore,
    zoomController,
    notationGraphStore,
  } = useContext(EditorContext);
  const groups = useAtomValue(timeGroupStore.groupsAtom);
  const activeId = useAtomValue(timeGroupStore.activeGroupIdAtom);
  const selectedNoteheads = useAtomValue(timeGroupStore.selectedNoteheadsAtom);
  const selectedGroupedMembers = useAtomValue(
    timeGroupStore.selectedGroupedMembersAtom,
  );
  const selectionAnalysis = useAtomValue(timeGroupStore.selectionAnalysisAtom);
  const selectedNodeIds = useAtomValue(selectionStore.selectedNodeIdsAtom);
  const coverage = useAtomValue(timeGroupStore.coverageAtom);
  const coverageReport = useAtomValue(timeGroupStore.coverageReportAtom);
  const malformedCount = useAtomValue(timeGroupStore.malformedCountAtom);
  const [showGroups, setShowGroups] = useAtom(timeGroupStore.showGroupsAtom);
  const [showAllLabels, setShowAllLabels] = useAtom(
    timeGroupStore.showAllGroupLabelsAtom,
  );
  const [noteheadsOnly, setNoteheadsOnly] = useAtom(
    classVisibilityStore.isNoteheadsOnlyAtom,
  );
  const pageImageMode = useAtomValue(editorStateStore.pageImageModeAtom);
  const readOnlyView = pageImageMode === PageImageMode.OriginalOnly;
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showCoverageReview, setShowCoverageReview] = useState(false);
  const [overlapReview, setOverlapReview] = useState<OverlapReview | null>(
    null,
  );
  const [undoDeletion, setUndoDeletion] = useState<{
    label: string;
    revision: number;
  } | null>(null);
  const [undoRemoval, setUndoRemoval] = useState<{
    count: number;
    revision: number;
  } | null>(null);
  const graphRevision = useRef(0);
  const canUndo = useAtomValue(mainMenuController.canUndoAtom);
  const selectionKey = JSON.stringify(
    [...selectionAnalysis.selectedNoteheadIds].sort((a, b) => a - b),
  );

  const activeGroup = groups.find((group) => group.id === activeId) ?? null;
  const activeLabel = activeGroup?.label ?? "";
  const existingMergeIds = mergeIds.filter((id) =>
    groups.some((group) => group.id === id),
  );
  const selectedSet = new Set(selectedNodeIds);
  const selectedMemberCount =
    activeGroup?.memberIds.filter((id) => selectedSet.has(id)).length ?? 0;
  const newMemberCount = activeGroup
    ? selectedNoteheads.filter(
        (node) => !activeGroup.memberIds.includes(node.id),
      ).length
    : 0;
  const ignoredSelectionCount =
    selectedNodeIds.length - selectedNoteheads.length;
  const canSplit =
    activeGroup !== null &&
    selectedMemberCount > 0 &&
    selectedMemberCount < activeGroup.memberIds.length;
  const reviewTarget =
    overlapReview?.kind === "add"
      ? selectionAnalysis.groupOptions.find(
          (item) => item.group.id === overlapReview.targetId,
        )
      : undefined;
  const reviewGroups = reviewTarget
    ? [reviewTarget.group, ...reviewTarget.conflictingGroups]
    : selectionAnalysis.overlapGroups;
  const reviewGroupIds = [...new Set(reviewGroups.map((group) => group.id))];

  useEffect(() => {
    setLabel(activeLabel);
  }, [activeId, activeLabel]);

  useEffect(() => {
    const changed = () => {
      graphRevision.current += 1;
      // the action-specific undo buttons apply only to the latest edit
      setUndoDeletion(null);
      setUndoRemoval(null);
      setOverlapReview(null);
    };
    notationGraphStore.onChange.subscribe(changed);
    return () => {
      notationGraphStore.onChange.unsubscribe(changed);
    };
  }, [notationGraphStore]);

  useEffect(() => {
    setOverlapReview((review) =>
      review?.selectionKey === selectionKey ? review : null,
    );
  }, [selectionKey]);

  function act(action: () => void, success?: string) {
    if (readOnlyView) return;
    try {
      setUndoDeletion(null);
      setUndoRemoval(null);
      action();
      setError("");
      if (success !== undefined) setMessage(success);
      if (document.activeElement?.tagName === "BUTTON") returnFocusToPage();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setMessage("");
    }
  }

  function requestReview(kind: OverlapReview["kind"], targetId?: string) {
    const analysis = timeGroupStore.classifySelection();
    setOverlapReview({
      kind,
      targetId,
      selectionKey: JSON.stringify(
        [...analysis.selectedNoteheadIds].sort((a, b) => a - b),
      ),
      revision: graphRevision.current,
    });
    setError("");
    setMessage("");
    returnFocusToPage();
  }

  function reviewStillCurrent() {
    const liveKey = JSON.stringify(
      [...timeGroupStore.classifySelection().selectedNoteheadIds].sort(
        (a, b) => a - b,
      ),
    );
    return (
      overlapReview !== null &&
      overlapReview.revision === graphRevision.current &&
      overlapReview.selectionKey === liveKey
    );
  }

  function createGroup() {
    if (readOnlyView) return;
    const analysis = timeGroupStore.classifySelection();
    if (
      analysis.exactMatches.length !== 1 &&
      analysis.overlapGroups.length > 0
    ) {
      requestReview("create");
      return;
    }
    act(
      () => {
        if (timeGroupStore.createFromSelection() === null)
          throw new Error("Select at least one notehead to create a group.");
        setOverlapReview(null);
      },
      analysis.exactMatches.length === 1
        ? "Opened the existing group. No duplicate was created."
        : "Group created.",
    );
  }

  function addToGroup(id: string) {
    if (readOnlyView) return;
    const option = timeGroupStore
      .classifySelection()
      .groupOptions.find((item) => item.group.id === id);
    if (!option || option.newMemberIds.length === 0) return;
    if (option.conflictingMemberIds.length > 0) {
      requestReview("add", id);
      return;
    }
    act(
      () => {
        timeGroupStore.addSelected(id);
        timeGroupStore.selectGroup(id);
        setOverlapReview(null);
      },
      `Added ${option.newMemberIds.length} ${option.newMemberIds.length === 1 ? "note" : "notes"} to ${option.group.label}.`,
    );
  }

  function deleteGroup(id: string) {
    const group = groups.find((item) => item.id === id);
    if (!group) return;
    act(() => {
      timeGroupStore.deleteGroup(id);
      setUndoDeletion({ label: group.label, revision: graphRevision.current });
    }, `${group.label} deleted. Notes and other memberships are kept.`);
  }

  function removeSelectedFromAllGroups() {
    if (readOnlyView) return;
    act(() => {
      const count = timeGroupStore.removeSelectedFromAllGroups();
      if (count > 0) {
        setUndoRemoval({ count, revision: graphRevision.current });
        setMessage(
          `Removed ${count} selected ${count === 1 ? "note" : "notes"} from all groups. Notes are kept.`,
        );
      } else {
        setMessage(
          "Select a grouped note on the page to remove its memberships.",
        );
      }
    });
  }

  function returnFocusToPage() {
    // otherwise the scene ignores the next drag
    (document.activeElement as HTMLElement | null)?.blur();
  }

  function selectMissing(nextOnly: boolean) {
    if (readOnlyView) return;
    setNoteheadsOnly(true);
    if (nextOnly) {
      const id = timeGroupStore.selectNextUngrouped();
      if (id !== null)
        zoomController.zoomToNode(notationGraphStore.getNode(id));
    } else {
      timeGroupStore.selectUngrouped();
    }
    returnFocusToPage();
  }

  const hasRecordProblems =
    coverageReport.malformedRecords > 0 ||
    coverageReport.nonNoteheadMemberIds.length > 0;
  const coverageState =
    coverageReport.totalNoteheads === 0
      ? "empty"
      : !coverageReport.allNoteheadsGrouped
        ? "incomplete"
        : hasRecordProblems || coverageReport.overlappingNodeIds.length > 0
          ? "review"
          : "complete";

  const createGroupButton = (
    <Button
      size="sm"
      data-testid="time-group-create"
      variant="solid"
      color="primary"
      disabled={readOnlyView || selectedNoteheads.length === 0}
      onClick={createGroup}
      sx={{ minWidth: 0, flex: 1, whiteSpace: "normal" }}
    >
      {selectionAnalysis.exactMatches.length === 1
        ? "Open existing group"
        : selectionAnalysis.overlapGroups.length > 0
          ? "Review existing groups"
          : `Create group (${selectedNoteheads.length})`}
    </Button>
  );

  return (
    <Stack spacing={1} data-testid="time-groups-panel">
      <Switch
        size="sm"
        checked={noteheadsOnly}
        disabled={readOnlyView}
        onChange={(event) => {
          if (event.target.checked) selectionStore.clearSelection();
          setNoteheadsOnly(event.target.checked);
          returnFocusToPage();
        }}
        title="Show only noteheads. Drag from empty space to select; Shift adds to selection."
        endDecorator="Noteheads only"
        slotProps={{ input: { "aria-label": "Noteheads only" } }}
      />
      <Switch
        size="sm"
        checked={showGroups}
        onChange={(event) => {
          setShowGroups(event.target.checked);
          returnFocusToPage();
        }}
        title="Green ring: grouped. Blue diamond: current group. Numbers: multiple groups. !: review needed."
        endDecorator="Show groups on page"
        slotProps={{ input: { "aria-label": "Show time groups on page" } }}
      />
      <Switch
        size="sm"
        checked={showAllLabels}
        disabled={!showGroups}
        onChange={(event) => {
          setShowAllLabels(event.target.checked);
          returnFocusToPage();
        }}
        endDecorator="Show all group labels"
        slotProps={{ input: { "aria-label": "Show all group labels" } }}
      />
      <Box aria-live="polite" data-testid="time-group-coverage">
        <Typography level="title-sm">
          {selectedNoteheads.length} selected noteheads
        </Typography>
        <Typography level="body-xs">
          {coverage.grouped} / {coverage.total} grouped · {coverage.ungrouped}{" "}
          ungrouped
        </Typography>
        {ignoredSelectionCount > 0 && (
          <Typography level="body-xs" color="neutral">
            {ignoredSelectionCount} other selected symbols
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={0.75}>
        {activeGroup === null && createGroupButton}
        <Button
          size="sm"
          variant="outlined"
          disabled={readOnlyView || coverage.ungrouped === 0}
          onClick={() => selectMissing(false)}
          sx={{ minWidth: 0, flex: 1, whiteSpace: "normal" }}
        >
          Select ungrouped
        </Button>
      </Stack>
      <Stack spacing={0.75} data-testid="time-group-editing-controls">
        {activeGroup !== null && (
          <Stack
            spacing={0.75}
            data-testid="active-time-group"
            data-group-id={activeGroup.id}
            sx={{ borderLeft: "3px solid #38bdf8", pl: 1 }}
          >
            <Typography level="title-sm">
              Current {activeGroup.label}
            </Typography>
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ alignItems: "stretch" }}
            >
              <Button
                size="sm"
                data-testid="add-to-active-time-group"
                disabled={readOnlyView || newMemberCount === 0}
                onClick={() => addToGroup(activeGroup.id)}
                sx={{ minWidth: 0, flex: 1, whiteSpace: "normal" }}
              >
                {newMemberCount > 0
                  ? `Add ${newMemberCount} ${newMemberCount === 1 ? "note" : "notes"} to ${activeGroup.label}`
                  : "No new notes to add"}
              </Button>
              {createGroupButton}
            </Stack>
            <Box component="details">
              <Box
                component="summary"
                sx={{ cursor: "pointer", fontSize: "sm", mb: 0.75 }}
              >
                More group actions
              </Box>
              {activeGroup !== null && (
                <Stack spacing={0.75}>
                  <Box
                    component="form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!label.trim() || label.trim() === activeGroup.label)
                        return;
                      act(() => {
                        timeGroupStore.renameGroup(
                          activeGroup.id,
                          label.trim(),
                        );
                      }, "Group renamed.");
                    }}
                  >
                    <FormControl size="sm">
                      <FormLabel>Group label</FormLabel>
                      <Stack direction="row" spacing={0.5}>
                        <Input
                          size="sm"
                          value={label}
                          disabled={readOnlyView}
                          onChange={(event) => setLabel(event.target.value)}
                          slotProps={{
                            input: {
                              "aria-label": "Group label",
                              maxLength: 80,
                            },
                          }}
                          sx={{ minWidth: 0, flex: 1 }}
                        />
                        <Button
                          size="sm"
                          variant="outlined"
                          type="submit"
                          disabled={
                            readOnlyView ||
                            !label.trim() ||
                            label.trim() === activeGroup.label
                          }
                        >
                          Rename
                        </Button>
                      </Stack>
                    </FormControl>
                  </Box>
                  <Typography level="body-xs">
                    {selectedMemberCount} of {activeGroup.memberIds.length}{" "}
                    members selected.
                  </Typography>
                  {activeGroup.nonNoteheadIds.length > 0 && (
                    <Alert size="sm" color="warning">
                      {activeGroup.nonNoteheadIds.length} members are no longer
                      noteheads. Select members to review them.
                    </Alert>
                  )}
                  <Button
                    size="sm"
                    variant="plain"
                    disabled={readOnlyView}
                    onClick={() => {
                      const memberClasses = new Set(
                        activeGroup.memberIds.map(
                          (id) => notationGraphStore.getNode(id).className,
                        ),
                      );
                      if (
                        [...memberClasses].some((className) =>
                          classVisibilityStore.hiddenClasses.has(className),
                        )
                      ) {
                        // show hidden member classes before selecting them
                        classVisibilityStore.setNoteheadsOnly(false);
                        classVisibilityStore.setUncertainOnly(false);
                        for (const className of memberClasses)
                          classVisibilityStore.setClassVisibility(
                            className,
                            true,
                          );
                        setMessage("Showing all member classes for review.");
                      }
                      timeGroupStore.selectMembers(activeGroup.id);
                      returnFocusToPage();
                    }}
                  >
                    Select members on page
                  </Button>
                  <Stack direction="row" spacing={0.5}>
                    <Button
                      size="sm"
                      variant="outlined"
                      disabled={readOnlyView || selectedMemberCount === 0}
                      onClick={() =>
                        act(() => {
                          timeGroupStore.removeSelected(activeGroup.id);
                        }, "Selected memberships removed. Notes are kept.")
                      }
                      sx={{ minWidth: 0, flex: 1, whiteSpace: "normal" }}
                    >
                      Remove from this group only ({selectedMemberCount})
                    </Button>
                  </Stack>
                  <Button
                    size="sm"
                    variant="outlined"
                    title="Select some members and leave at least one in this group."
                    disabled={readOnlyView || !canSplit}
                    onClick={() =>
                      act(() => {
                        if (
                          timeGroupStore.splitSelected(activeGroup.id) === null
                        ) {
                          throw new Error(
                            "Select some members and leave at least one in the group.",
                          );
                        }
                      }, "Selected members moved into a separate group.")
                    }
                  >
                    Split selected into new group
                  </Button>
                </Stack>
              )}
            </Box>
          </Stack>
        )}
        <Button
          size="sm"
          variant="soft"
          color="danger"
          data-testid="delete-time-group-active"
          disabled={readOnlyView || activeGroup === null}
          title="Delete this group while keeping its notes and other memberships."
          onClick={() => {
            if (activeGroup) deleteGroup(activeGroup.id);
          }}
          sx={{ whiteSpace: "normal" }}
        >
          {activeGroup
            ? `Delete ${activeGroup.label} · keep notes`
            : "Delete group · keep notes"}
        </Button>
        {error && (
          <Alert color="danger" size="sm">
            {error}
          </Alert>
        )}
        {message && (
          <Typography level="body-xs" role="status">
            {message}
          </Typography>
        )}
        {undoDeletion !== null && canUndo && (
          <Button
            size="sm"
            variant="outlined"
            data-testid="undo-time-group-delete"
            disabled={
              readOnlyView || undoDeletion.revision !== graphRevision.current
            }
            onClick={() => {
              if (
                readOnlyView ||
                undoDeletion.revision !== graphRevision.current
              )
                return;
              mainMenuController.undo();
              setUndoDeletion(null);
              setMessage(`Undid deletion of ${undoDeletion.label}.`);
              setError("");
              returnFocusToPage();
            }}
          >
            Undo deletion of {undoDeletion.label}
          </Button>
        )}
      </Stack>
      <Button
        size="sm"
        variant="outlined"
        data-testid="remove-selected-from-all-groups"
        title="Remove selected notes from every group. The notes are kept."
        disabled={readOnlyView || selectedGroupedMembers.length === 0}
        onClick={removeSelectedFromAllGroups}
        sx={{ whiteSpace: "normal" }}
      >
        Remove from all groups ({selectedGroupedMembers.length})
      </Button>
      {undoRemoval !== null && canUndo && (
        <Button
          size="sm"
          variant="soft"
          data-testid="undo-time-group-remove"
          disabled={
            readOnlyView || undoRemoval.revision !== graphRevision.current
          }
          onClick={() => {
            if (readOnlyView || undoRemoval.revision !== graphRevision.current)
              return;
            mainMenuController.undo();
            setUndoRemoval(null);
            setMessage(
              `Restored group memberships for ${undoRemoval.count} ${undoRemoval.count === 1 ? "note" : "notes"}.`,
            );
            setError("");
            returnFocusToPage();
          }}
        >
          Undo removing {undoRemoval.count}{" "}
          {undoRemoval.count === 1 ? "note" : "notes"} from groups
        </Button>
      )}
      {overlapReview !== null && (
        <Alert
          size="sm"
          color="warning"
          data-testid="time-group-overlap-review"
          sx={{ alignItems: "flex-start" }}
        >
          <Stack spacing={0.75} sx={{ minWidth: 0, width: "100%" }}>
            <Typography level="title-sm">
              {reviewTarget
                ? `Add to ${reviewTarget.group.label} with overlapping memberships?`
                : selectionAnalysis.exactMatches.length > 1
                  ? "This selection matches multiple existing groups."
                  : "Some selected notes already have a group."}
            </Typography>
            <Typography level="body-xs">
              {reviewTarget
                ? "Adding keeps their existing memberships. Merge instead if these groups represent the same time position."
                : "Choose an existing group to add missing notes. No new group has been created."}
            </Typography>
            <Typography level="body-xs">
              Related groups:{" "}
              {reviewGroups.map((group) => group.label).join(", ")}
            </Typography>
            {overlapReview.kind === "create" &&
              selectionAnalysis.groupOptions
                .filter((option) =>
                  selectionAnalysis.overlapGroups.some(
                    (group) => group.id === option.group.id,
                  ),
                )
                .map((option) => (
                  <Button
                    key={option.group.id}
                    size="sm"
                    variant="outlined"
                    data-testid="add-to-existing-time-group"
                    data-group-id={option.group.id}
                    disabled={readOnlyView}
                    sx={{ whiteSpace: "normal" }}
                    onClick={() => {
                      if (readOnlyView || !reviewStillCurrent()) return;
                      if (option.newMemberIds.length > 0)
                        addToGroup(option.group.id);
                      else {
                        timeGroupStore.selectGroup(option.group.id);
                        setOverlapReview(null);
                        setMessage(
                          `Opened ${option.group.label}. No duplicate was created.`,
                        );
                        returnFocusToPage();
                      }
                    }}
                  >
                    {option.newMemberIds.length > 0
                      ? `Add ${option.newMemberIds.length} ${option.newMemberIds.length === 1 ? "note" : "notes"} to ${option.group.label}`
                      : `Open ${option.group.label}`}
                  </Button>
                ))}
            {reviewTarget && (
              <Button
                size="sm"
                color="warning"
                data-testid="confirm-overlapping-add"
                disabled={
                  readOnlyView || reviewTarget.newMemberIds.length === 0
                }
                sx={{ whiteSpace: "normal" }}
                onClick={() => {
                  if (!reviewStillCurrent()) return;
                  act(() => {
                    timeGroupStore.addSelected(reviewTarget.group.id, {
                      allowOverlap: true,
                    });
                    timeGroupStore.selectGroup(reviewTarget.group.id);
                    setOverlapReview(null);
                  }, `Added notes to ${reviewTarget.group.label}. Other memberships are kept.`);
                }}
              >
                Add to {reviewTarget.group.label} and keep other memberships
              </Button>
            )}
            {reviewGroupIds.length >= 2 && (
              <>
                <Typography level="body-xs">
                  Merge combines all members of these groups and adds the
                  selected notes. Other groups are kept.
                </Typography>
                <Button
                  size="sm"
                  variant="outlined"
                  data-testid="merge-overlapping-time-groups"
                  disabled={readOnlyView}
                  sx={{ whiteSpace: "normal" }}
                  onClick={() => {
                    if (!reviewStillCurrent()) return;
                    act(() => {
                      timeGroupStore.mergeGroups(reviewGroupIds, {
                        includeSelected: true,
                      });
                      setOverlapReview(null);
                      setMergeIds([]);
                    }, "Related groups merged and selected notes added. Other groups are kept.");
                  }}
                >
                  Merge {reviewGroupIds.length} groups and add selected notes
                </Button>
              </>
            )}
            {overlapReview.kind === "create" &&
              selectionAnalysis.exactMatches.length === 0 && (
                <Button
                  size="sm"
                  variant="plain"
                  color="warning"
                  data-testid="create-overlapping-time-group"
                  disabled={readOnlyView}
                  sx={{ whiteSpace: "normal" }}
                  onClick={() => {
                    if (!reviewStillCurrent()) return;
                    act(() => {
                      timeGroupStore.createFromSelection({
                        allowOverlap: true,
                      });
                      setOverlapReview(null);
                    }, "Overlapping group created. Existing groups are kept.");
                  }}
                >
                  Create overlapping group anyway
                </Button>
              )}
            <Button
              size="sm"
              variant="plain"
              data-testid="cancel-time-group-overlap"
              onClick={() => {
                setOverlapReview(null);
                returnFocusToPage();
              }}
            >
              Cancel
            </Button>
          </Stack>
        </Alert>
      )}
      <Stack direction="row" spacing={0.75}>
        <Button
          size="sm"
          variant="outlined"
          onClick={() => {
            setShowCoverageReview(true);
            returnFocusToPage();
          }}
          sx={{ minWidth: 0, flex: 1, whiteSpace: "normal" }}
        >
          Check coverage
        </Button>
        <Button
          size="sm"
          variant="outlined"
          disabled={readOnlyView || coverage.ungrouped === 0}
          onClick={() => selectMissing(true)}
          sx={{ minWidth: 0, flex: 1, whiteSpace: "normal" }}
        >
          Next ungrouped
        </Button>
      </Stack>
      {showCoverageReview && (
        <Alert
          size="sm"
          color={coverageState === "complete" ? "success" : "warning"}
          data-testid="time-group-coverage-review"
          data-coverage-state={coverageState}
          sx={{ alignItems: "flex-start" }}
        >
          <Stack spacing={0.5} aria-live="polite">
            <Typography level="title-sm">
              {coverageReport.totalNoteheads === 0
                ? "No noteheads to check."
                : !coverageReport.allNoteheadsGrouped
                  ? `${coverageReport.ungroupedNodeIds.length} noteheads still need a group.`
                  : "All noteheads grouped."}
            </Typography>
            {coverageReport.ungroupedNodeIds.length > 0 && (
              <Typography level="body-xs">
                Use Next ungrouped to find each missing notehead. Partial work
                can still be saved.
              </Typography>
            )}
            {coverageReport.overlappingNodeIds.length > 0 && (
              <Typography level="body-xs">
                {coverageReport.overlappingNodeIds.length} noteheads belong to
                multiple groups. Review whether these overlaps are intentional.
              </Typography>
            )}
            {hasRecordProblems && (
              <Typography level="body-xs">
                Review {coverageReport.malformedRecords} invalid group records
                and {coverageReport.nonNoteheadMemberIds.length} non-notehead
                members before finishing.
              </Typography>
            )}
            <Typography level="body-xs">
              This check updates after edits. Coverage does not confirm musical
              correctness or mark the document reviewed.
            </Typography>
          </Stack>
        </Alert>
      )}
      {readOnlyView && (
        <Alert size="sm" color="neutral">
          Return to the annotation view to edit groups.
        </Alert>
      )}
      {malformedCount > 0 && (
        <Alert size="sm" color="warning">
          {malformedCount} invalid group records were found. Valid groups remain
          available; invalid records are preserved.
        </Alert>
      )}
      <Divider />
      {groups.length === 0 ? (
        <Typography level="body-xs">No time groups yet.</Typography>
      ) : (
        <>
          <Stack
            spacing={0.5}
            role="group"
            aria-label="Time groups"
            sx={{ maxHeight: 220, overflowY: "auto" }}
          >
            {groups.map((group, index) => {
              const name = group.label || `Group ${index + 1}`;
              return (
                <Stack
                  direction="row"
                  spacing={0.5}
                  key={group.id}
                  sx={{ alignItems: "center" }}
                >
                  <Checkbox
                    size="sm"
                    checked={existingMergeIds.includes(group.id)}
                    disabled={readOnlyView}
                    slotProps={{
                      input: { "aria-label": `Include ${name} in merge` },
                    }}
                    onChange={(event) =>
                      setMergeIds(
                        event.target.checked
                          ? [...existingMergeIds, group.id]
                          : existingMergeIds.filter((id) => id !== group.id),
                      )
                    }
                  />
                  <Button
                    size="sm"
                    variant={activeId === group.id ? "soft" : "plain"}
                    color={activeId === group.id ? "primary" : "neutral"}
                    disabled={readOnlyView}
                    aria-pressed={activeId === group.id}
                    title={name}
                    onClick={() => {
                      setMessage("");
                      setError("");
                      timeGroupStore.selectGroup(group.id);
                      returnFocusToPage();
                    }}
                    sx={{
                      justifyContent: "space-between",
                      minWidth: 0,
                      flex: 1,
                      gap: 0.75,
                    }}
                  >
                    <Typography
                      level="body-sm"
                      sx={{ overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {name}
                    </Typography>
                    <Typography level="body-xs" sx={{ whiteSpace: "nowrap" }}>
                      {group.provenance === "predicted" ? "predicted · " : ""}
                      {group.memberIds.length}{" "}
                      {group.memberIds.length === 1 ? "note" : "notes"}
                    </Typography>
                  </Button>
                  <IconButton
                    size="sm"
                    variant="plain"
                    color="danger"
                    disabled={readOnlyView}
                    aria-label={`Delete ${name} (keep notes)`}
                    title={`Delete ${name} (keep notes)`}
                    data-testid="delete-time-group-row"
                    data-group-id={group.id}
                    onClick={() => deleteGroup(group.id)}
                    sx={{ flexShrink: 0 }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              );
            })}
          </Stack>
          <Button
            size="sm"
            variant="outlined"
            disabled={readOnlyView || existingMergeIds.length < 2}
            onClick={() =>
              act(() => {
                if (timeGroupStore.mergeGroups(existingMergeIds) === null) {
                  throw new Error(
                    "Check at least two existing groups to merge.",
                  );
                }
                setMergeIds([]);
              }, "Checked groups merged. Notes and other memberships are preserved.")
            }
          >
            Merge checked groups ({existingMergeIds.length})
          </Button>
        </>
      )}
    </Stack>
  );
}
