import { Document } from "./SimpleBackendApi";
import {
  Link as RouterLink,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import Link from "@mui/joy/Link";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  FormControl,
  FormLabel,
  Input,
  Option,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/joy";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import PersonIcon from "@mui/icons-material/Person";
import CommentOutlinedIcon from "@mui/icons-material/CommentOutlined";
import { useEffect, useState } from "react";
import { classNameToHue } from "../../mung/classNameToHue";
import {
  conversionUnavailableReason,
  documentConversionPath,
} from "./DocumentConversion";
import {
  DOCUMENT_STAGE_IDS,
  DOCUMENT_STAGE_META,
  DOCUMENT_STATUS_META,
  DocStatus,
  DocumentStage,
  DocumentStagePatch,
  DocumentStageState,
  readDocumentStages,
} from "./DocumentWorkflow";

const STATUS_OPTIONS = Object.keys(DOCUMENT_STATUS_META) as DocStatus[];

export interface DocumentsListProps {
  readonly documents: Document[];
  readonly pendingDocuments: ReadonlySet<string>;
  readonly saveErrors: Readonly<Record<string, string>>;
  readonly onStatusChange: (
    name: string,
    stage: DocumentStage,
    patch: DocumentStagePatch,
  ) => void;
  readonly onOpenComments: (documentName: string) => void;
}

function StageControl({
  stage,
  state,
  disabled,
  saving,
  unavailable,
  onChange,
}: {
  readonly stage: DocumentStage;
  readonly state: DocumentStageState;
  readonly disabled: boolean;
  readonly saving: boolean;
  readonly unavailable: boolean;
  readonly onChange: (patch: DocumentStagePatch) => void;
}) {
  const [annotatorDraft, setAnnotatorDraft] = useState(state.annotator);
  const label = DOCUMENT_STAGE_META[stage].label;
  const meta = DOCUMENT_STATUS_META[state.status];

  useEffect(() => {
    if (!saving) setAnnotatorDraft(state.annotator);
  }, [state.annotator, saving]);

  return (
    <Box
      data-testid={`workflow-stage-${stage}`}
      sx={{
        minWidth: 0,
        p: 1.25,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "sm",
        bgcolor: "background.surface",
      }}
    >
      <Tooltip title={DOCUMENT_STAGE_META[stage].description} placement="top">
        <Typography level="title-sm" sx={{ mb: 0.75 }}>
          {label}
        </Typography>
      </Tooltip>
      <Select
        size="sm"
        value={unavailable ? null : state.status}
        placeholder="Unavailable"
        color={unavailable ? "neutral" : meta.color}
        variant="soft"
        disabled={disabled}
        aria-label={`${label} status`}
        onChange={(_event, value) => {
          if (value && value !== state.status) onChange({ status: value });
        }}
        sx={{ width: "100%" }}
      >
        {(Object.keys(DOCUMENT_STATUS_META) as DocStatus[]).map((status) => (
          <Option key={status} value={status}>
            {DOCUMENT_STATUS_META[status].label}
          </Option>
        ))}
      </Select>
      <Input
        size="sm"
        placeholder="Annotator"
        value={annotatorDraft}
        disabled={disabled}
        startDecorator={<PersonIcon />}
        slotProps={{ input: { "aria-label": `${label} annotator` } }}
        sx={{ mt: 0.75, width: "100%" }}
        onChange={(event) => setAnnotatorDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            (event.target as HTMLInputElement).blur();
          }
          if (event.key === "Escape") {
            setAnnotatorDraft(state.annotator);
          }
        }}
        onBlur={() => {
          if (disabled) return;
          const annotator = annotatorDraft.trim();
          setAnnotatorDraft(annotator);
          if (annotator !== state.annotator) onChange({ annotator });
        }}
      />
    </Box>
  );
}

export function DocumentsList({
  documents,
  pendingDocuments,
  saveErrors,
  onStatusChange,
  onOpenComments,
}: DocumentsListProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const stageFilter =
    DOCUMENT_STAGE_IDS.find((stage) => stage === searchParams.get("stage")) ??
    "recognition";
  const statusFilter =
    STATUS_OPTIONS.find((status) => status === searchParams.get("status")) ??
    "all";
  const documentRows = documents.map((document) => ({
    document,
    stages: readDocumentStages(document),
  }));
  const filteredRows = documentRows.filter(
    ({ document, stages }) =>
      statusFilter === "all" ||
      (!document.workflowStatusError &&
        stages[stageFilter].status === statusFilter),
  );
  const setFilter = (
    name: "stage" | "status",
    value: string,
    defaultValue: string,
  ) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === defaultValue) next.delete(name);
        else next.set(name, value);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <>
      <Stack
        direction="row"
        sx={{ my: 2, gap: 2, alignItems: "flex-end", flexWrap: "wrap" }}
      >
        <FormControl size="sm" sx={{ minWidth: 220 }}>
          <FormLabel>Stage</FormLabel>
          <Select
            aria-label="Filter pages by stage"
            value={stageFilter}
            onChange={(_event, value) => {
              if (value !== null) setFilter("stage", value, "recognition");
            }}
          >
            {DOCUMENT_STAGE_IDS.map((stage) => (
              <Option key={stage} value={stage}>
                {DOCUMENT_STAGE_META[stage].label}
              </Option>
            ))}
          </Select>
        </FormControl>
        <FormControl size="sm" sx={{ minWidth: 220 }}>
          <FormLabel>Status</FormLabel>
          <Select
            aria-label="Filter pages by status"
            value={statusFilter}
            onChange={(_event, value) => {
              if (value !== null) setFilter("status", value, "all");
            }}
          >
            <Option value="all">All pages ({documents.length})</Option>
            {STATUS_OPTIONS.map((status) => (
              <Option key={status} value={status}>
                {DOCUMENT_STATUS_META[status].label} (
                {
                  documentRows.filter(
                    ({ document, stages }) =>
                      !document.workflowStatusError &&
                      stages[stageFilter].status === status,
                  ).length
                }
                )
              </Option>
            ))}
          </Select>
        </FormControl>
        <Typography level="body-sm" aria-live="polite" sx={{ pb: 0.5 }}>
          {filteredRows.length} of {documents.length} pages
        </Typography>
      </Stack>
      {filteredRows.length === 0 && (
        <Box sx={{ py: 3, textAlign: "center" }}>
          <Typography level="body-md">
            {documents.length === 0
              ? "No pages yet."
              : "No pages with this stage status."}
          </Typography>
          {statusFilter !== "all" && (
            <Button
              size="sm"
              variant="plain"
              sx={{ mt: 1 }}
              onClick={() => setFilter("status", "all", "all")}
            >
              Show all pages
            </Button>
          )}
        </Box>
      )}
      {filteredRows.map(({ document, stages }) => {
        const saving = pendingDocuments.has(document.name);
        const locked = Boolean(document.workflowStatusError);
        const conversionReason = conversionUnavailableReason(
          document,
          saving,
          saveErrors[document.name],
        );
        return (
          <Card
            key={document.name}
            data-testid="document-workflow-card"
            data-document-name={document.name}
            variant="outlined"
            sx={{ mb: 1.5, gap: 1.25 }}
          >
            <Stack
              direction="row"
              sx={{ alignItems: "flex-start", gap: 1.25, flexWrap: "wrap" }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  p: 1,
                  background: `hsl(${classNameToHue(document.name)}, 100%, 80%)`,
                  borderRadius: "sm",
                }}
              >
                <MusicNoteIcon
                  sx={{
                    color: `hsl(${classNameToHue(document.name)}, 100%, 35%)`,
                  }}
                />
              </Box>
              <Box sx={{ flex: "1 1 200px", minWidth: 0 }}>
                <Link
                  component={RouterLink}
                  to={`/simple-backend/${encodeURIComponent(document.name)}`}
                  target="_blank"
                  sx={{ overflowWrap: "anywhere", fontWeight: "lg" }}
                >
                  {document.name}
                </Link>
                <Typography level="body-xs" sx={{ mt: 0.25 }}>
                  Last modified:{" "}
                  {new Date(document.modifiedAt).toLocaleString()}
                </Typography>
                {(document.unresolvedCommentCount ?? 0) > 0 && (
                  <Chip
                    size="sm"
                    color="danger"
                    variant="soft"
                    sx={{ mt: 0.5 }}
                  >
                    {document.unresolvedCommentCount} comment
                    {document.unresolvedCommentCount === 1 ? "" : "s"} need
                    attention
                  </Chip>
                )}
              </Box>
              <Tooltip
                title={
                  conversionReason ??
                  "View the converted score and review its proposals."
                }
              >
                <span>
                  <Button
                    size="sm"
                    variant="soft"
                    disabled={conversionReason !== null}
                    aria-disabled={conversionReason !== null}
                    data-testid="convert-document"
                    onClick={() => {
                      if (conversionReason === null)
                        navigate(
                          documentConversionPath(document.name, searchParams),
                        );
                    }}
                    sx={{ whiteSpace: "nowrap" }}
                  >
                    Convert to score
                  </Button>
                </span>
              </Tooltip>
              <Button
                size="sm"
                variant="outlined"
                color={
                  (document.unresolvedCommentCount ?? 0) > 0
                    ? "danger"
                    : "neutral"
                }
                startDecorator={<CommentOutlinedIcon />}
                onClick={() => onOpenComments(document.name)}
                sx={{ whiteSpace: "nowrap" }}
              >
                Comments
                {(document.commentCount ?? 0) > 0
                  ? ` (${document.commentCount})`
                  : ""}
              </Button>
            </Stack>
            {locked ? (
              <Alert color="warning" data-testid="workflow-status-error">
                Progress unavailable. {document.workflowStatusError}
              </Alert>
            ) : null}
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "minmax(0, 1fr)",
                  sm: "repeat(2, minmax(0, 1fr))",
                  lg: "repeat(4, minmax(0, 1fr))",
                },
                gap: 1,
              }}
            >
              {DOCUMENT_STAGE_IDS.map((stage) => (
                <StageControl
                  key={stage}
                  stage={stage}
                  state={stages[stage]}
                  disabled={saving || locked}
                  saving={saving}
                  unavailable={locked}
                  onChange={(patch) =>
                    onStatusChange(document.name, stage, patch)
                  }
                />
              ))}
            </Box>
            {saving && (
              <Typography
                level="body-sm"
                role="status"
                data-testid="workflow-saving"
              >
                Saving progress…
              </Typography>
            )}
            {saveErrors[document.name] && (
              <Alert color="danger" data-testid="workflow-save-error">
                Could not save progress. {saveErrors[document.name]}
              </Alert>
            )}
          </Card>
        );
      })}
    </>
  );
}
