export const DOCUMENT_STAGE_IDS = [
  "recognition",
  "assembly",
  "syntax",
  "temporal",
] as const;

export type DocumentStage = (typeof DOCUMENT_STAGE_IDS)[number];
export type DocStatus =
  | "not-started"
  | "in-progress"
  | "pending-review"
  | "changes-requested"
  | "done";

export interface DocumentStageState {
  readonly status: DocStatus;
  readonly annotator: string;
}

export type DocumentStages = Readonly<
  Record<DocumentStage, DocumentStageState>
>;
export type DocumentStagePatch =
  | { readonly status: DocStatus; readonly annotator?: string }
  | { readonly status?: DocStatus; readonly annotator: string };

export const DOCUMENT_STAGE_META: Record<
  DocumentStage,
  { readonly label: string; readonly description: string }
> = {
  recognition: {
    label: "Symbol Recognition",
    description: "Recognize and review symbols and their bounding boxes.",
  },
  assembly: {
    label: "Precedence Links",
    description: "Review the directed ordering links between noteheads.",
  },
  syntax: {
    label: "Syntax Links",
    description: "Review connections between noteheads and notation symbols.",
  },
  temporal: {
    label: "Temporal Structure",
    description: "Group noteheads that occupy the same time position.",
  },
};

export const DOCUMENT_STATUS_META: Record<
  DocStatus,
  {
    readonly label: string;
    readonly color: "neutral" | "warning" | "primary" | "danger" | "success";
  }
> = {
  "not-started": { label: "Not started", color: "neutral" },
  "in-progress": { label: "In progress", color: "warning" },
  "pending-review": { label: "Pending review", color: "primary" },
  "changes-requested": { label: "Changes requested", color: "danger" },
  done: { label: "Done", color: "success" },
};

function readStage(value: unknown): DocumentStageState {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid document workflow status.");
  }
  const { status, annotator } = value as Record<string, unknown>;
  if (
    typeof status !== "string" ||
    !Object.prototype.hasOwnProperty.call(DOCUMENT_STATUS_META, status) ||
    typeof annotator !== "string"
  ) {
    throw new Error("Invalid document workflow status.");
  }
  return { status: status as DocStatus, annotator };
}

/** Legacy records have progress for recognition only; never infer later stages. */
export function readDocumentStages(value: {
  readonly status?: unknown;
  readonly annotator?: unknown;
  readonly stages?: unknown;
}): DocumentStages {
  if (value.stages === undefined) {
    return {
      recognition: readStage({
        status: value.status ?? "not-started",
        annotator: value.annotator ?? "",
      }),
      assembly: { status: "not-started", annotator: "" },
      syntax: { status: "not-started", annotator: "" },
      temporal: { status: "not-started", annotator: "" },
    };
  }
  if (typeof value.stages !== "object" || value.stages === null) {
    throw new Error("Invalid document workflow status.");
  }
  const stages = value.stages as Record<string, unknown>;
  return {
    recognition: readStage(stages.recognition),
    assembly: readStage(stages.assembly),
    // Older three-stage records retain their progress; syntax needs a separate review.
    syntax: Object.prototype.hasOwnProperty.call(stages, "syntax")
      ? readStage(stages.syntax)
      : { status: "not-started", annotator: "" },
    temporal: readStage(stages.temporal),
  };
}

/** A successful HTTP response alone is not proof that all stages were saved. */
export function readSavedDocumentStages(value: unknown): DocumentStages {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as Record<string, unknown>).ok !== true ||
    (value as Record<string, unknown>).stages === undefined
  ) {
    throw new Error(
      "The server did not confirm the workflow update. Reload to check its status.",
    );
  }
  const stages = (value as Record<string, unknown>).stages;
  if (
    typeof stages !== "object" ||
    stages === null ||
    !DOCUMENT_STAGE_IDS.every((stage) =>
      Object.prototype.hasOwnProperty.call(stages, stage),
    )
  ) {
    throw new Error(
      "The server did not confirm the workflow update. Reload to check its status.",
    );
  }
  return readDocumentStages(value as Record<string, unknown>);
}
