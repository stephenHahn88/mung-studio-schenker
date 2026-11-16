import {
  DOCUMENT_STAGE_IDS,
  DOCUMENT_STATUS_META,
  readDocumentStages,
} from "./DocumentWorkflow";

/** Result of the backend action convert-document. */
export interface DocumentConversionResult {
  readonly document: string;
  /** Output of convert_page. */
  readonly result: unknown;
}

export class DocumentConversionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "DocumentConversionError";
  }
}

/** Why the page cannot be converted yet, or null when all stages are done. */
export function conversionUnavailableReason(
  document: {
    readonly stages?: unknown;
    readonly workflowStatusError?: string;
  },
  pending = false,
  saveError?: string,
): string | null {
  if (pending) return "Wait for progress to finish saving.";
  if (document.workflowStatusError || saveError)
    return "Reload or save progress successfully before converting.";
  try {
    const stages = readDocumentStages(document);
    if (DOCUMENT_STAGE_IDS.every((stage) => stages[stage].status === "done"))
      return null;
  } catch {
    return "Progress is unavailable. Reload the directory to check it.";
  }
  return "Complete Symbol Recognition, Precedence Links, Syntax Links, and Temporal Structure first.";
}

/** The stage and status filters of a directory URL. */
function filterSuffix(search: string | URLSearchParams): string {
  const source = new URLSearchParams(search);
  const filtered = new URLSearchParams();
  const stage = source.get("stage");
  const status = source.get("status");
  if (DOCUMENT_STAGE_IDS.some((value) => value === stage))
    filtered.set("stage", stage!);
  if (
    status &&
    Object.prototype.hasOwnProperty.call(DOCUMENT_STATUS_META, status)
  )
    filtered.set("status", status);
  return filtered.size ? `?${filtered}` : "";
}

export function documentConversionPath(
  documentName: string,
  search: string | URLSearchParams = "",
): string {
  return `/simple-backend/${encodeURIComponent(documentName)}/conversion${filterSuffix(search)}`;
}

export function conversionDirectoryPath(search: string): string {
  return `/simple-backend${filterSuffix(search)}`;
}

export function readDocumentConversion(
  value: unknown,
): DocumentConversionResult {
  if (typeof value !== "object" || value === null)
    throw new Error("The server returned an invalid conversion result.");
  const data = value as Record<string, unknown>;
  if (
    typeof data.document !== "string" ||
    !("result" in data) ||
    data.result === undefined
  )
    throw new Error("The server returned an invalid conversion result.");
  return { document: data.document, result: data.result };
}

/** The "schenkernote" field of a converter result, or the whole result. */
export function conversionNotationJson(
  result: DocumentConversionResult,
): unknown {
  const value = result.result;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "schenkernote" in value
  ) {
    return (value as Record<string, unknown>).schenkernote;
  }
  return value;
}

/** Text of a JSON file offered for download. */
export function conversionJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** Download file name derived from the document name. */
export function conversionFileName(
  documentName: string,
  suffix: string = "",
): string {
  const base = documentName.replace(/[^A-Za-z0-9._-]+/g, "_") || "document";
  return `${base}${suffix}.json`;
}

export async function readConversionError(
  response: Response,
): Promise<DocumentConversionError> {
  const defaults: Record<number, string> = {
    401: "Your session is no longer valid. Sign in again from the directory.",
    403: "You do not have access to convert this page.",
    404: "This page could not be found. Return to the directory and reload it.",
    409: "The saved annotations changed during conversion. Please try again.",
    422: "This page cannot be converted yet. Review its notation, links and time groups.",
    503: "The converter is not available on this server.",
  };
  let detail: string | undefined;
  let code: string | undefined;
  try {
    const body = await response.json();
    if (typeof body.code === "string") code = body.code;
    if (typeof body.message === "string" && body.message.trim())
      detail = body.message;
    else if (typeof body.error === "string" && body.error.trim())
      detail = body.error;
  } catch {
    // not a JSON body
  }
  const fallback =
    defaults[response.status] ?? "Conversion failed. Please try again.";
  // the server message is shown except for these statuses
  const message = [401, 403, 404, 409].includes(response.status)
    ? fallback
    : (detail ?? fallback);
  return new DocumentConversionError(message, response.status, code);
}
