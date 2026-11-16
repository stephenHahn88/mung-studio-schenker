import { resolveBackendUrl } from "../../pages/simple-backend/resolveBackendUrl";

/**
 * Client for the model actions of the Python backend
 * (simple-php-backend/server.py and simple-php-backend/model_actions.py).
 *
 * Every action runs one of the models described in the paper on the page that
 * is open in the editor:
 *
 * - detect-symbols: symbol detector (YOLOv8L + RF-DETR)
 * - predict-syntax-links: syntax-link model
 * - predict-time-groups: time-group model
 * - predict-precedence: precedence-link model
 *
 * The client never writes MuNG data; the caller decides what to insert.
 */

/** Rectangle in page pixel coordinates. */
export interface PageRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** One node of the current graph, as sent to the relation models. */
export interface ModelNode {
  readonly id: number;
  readonly className: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface SymbolPrediction {
  readonly className: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly confidence: number | null;
}

export interface SymbolDetectionResponse {
  readonly model: string;
  readonly image: { readonly width: number; readonly height: number };
  readonly region: PageRegion | null;
  readonly predictions: SymbolPrediction[];
}

export interface PredictedLink {
  readonly source: number;
  readonly target: number;
  readonly score: number | null;
}

export interface LinkPredictionResponse {
  readonly model: string;
  readonly links: PredictedLink[];
}

export interface TimeGroupPredictionResponse {
  readonly model: string;
  /** Each group lists the ids of the nodes that share one onset. */
  readonly groups: number[][];
}

export type ModelActionId =
  | "symbols"
  | "syntaxLinks"
  | "timeGroups"
  | "precedence"
  | "conversion";

export interface ModelAvailability {
  readonly available: boolean;
  readonly label: string;
  readonly reason?: string;
}

export type ModelAvailabilityMap = Partial<
  Record<ModelActionId, ModelAvailability>
>;

/** Confidence inputs never silently substitute a different threshold. */
export function parseConfidence(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** Same key under which SimpleBackendConnection persists the user token. */
const USER_TOKEN_STORAGE_KEY = "mung-studio::simple-backend::user-token";

function readPersistedUserToken(): string | null {
  try {
    const raw = window.localStorage.getItem(USER_TOKEN_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function toModelNode(node: ModelNode): ModelNode {
  return {
    id: node.id,
    className: node.className,
    left: node.left,
    top: node.top,
    width: node.width,
    height: node.height,
  };
}

export class ModelApi {
  private readonly backendUrl: string;
  private readonly userToken: string | null;

  constructor(backendUrl?: string, userToken?: string | null) {
    const url =
      backendUrl ??
      resolveBackendUrl(process.env["SIMPLE_PHP_BACKEND_URL"] || "SAME_ORIGIN");
    if (url === undefined) {
      throw new Error("The backend URL is not specified.");
    }
    this.backendUrl = url;
    this.userToken =
      userToken === undefined ? readPersistedUserToken() : userToken;
  }

  public async listModels(): Promise<ModelAvailabilityMap> {
    const response = await fetch(this.buildUrl("list-models"), {
      headers: this.authHeaders(),
      cache: "no-store",
    });
    const data = await this.readJson(response, "Could not list models");
    return (data.models ?? {}) as ModelAvailabilityMap;
  }

  public async detectSymbols(
    documentName: string,
    region: PageRegion | null,
    scoreThreshold: number | null,
  ): Promise<SymbolDetectionResponse> {
    const data = await this.post("detect-symbols", {
      document: documentName,
      region,
      scoreThreshold,
    });
    if (!Array.isArray(data.predictions)) {
      throw new Error("Invalid symbol detection response.");
    }
    return data as SymbolDetectionResponse;
  }

  public async predictSyntaxLinks(
    documentName: string,
    nodes: readonly ModelNode[],
  ): Promise<LinkPredictionResponse> {
    return this.predictLinks("predict-syntax-links", documentName, nodes);
  }

  public async predictPrecedence(
    documentName: string,
    nodes: readonly ModelNode[],
  ): Promise<LinkPredictionResponse> {
    return this.predictLinks("predict-precedence", documentName, nodes);
  }

  public async predictTimeGroups(
    documentName: string,
    nodes: readonly ModelNode[],
  ): Promise<TimeGroupPredictionResponse> {
    const data = await this.post("predict-time-groups", {
      document: documentName,
      nodes: nodes.map(toModelNode),
    });
    if (
      !Array.isArray(data.groups) ||
      !data.groups.every(
        (group: unknown) =>
          Array.isArray(group) && group.every((id) => Number.isInteger(id)),
      )
    ) {
      throw new Error("Invalid time-group prediction response.");
    }
    return data as TimeGroupPredictionResponse;
  }

  private async predictLinks(
    action: string,
    documentName: string,
    nodes: readonly ModelNode[],
  ): Promise<LinkPredictionResponse> {
    const data = await this.post(action, {
      document: documentName,
      nodes: nodes.map(toModelNode),
    });
    if (
      !Array.isArray(data.links) ||
      !data.links.every(
        (link: any) =>
          Number.isInteger(link?.source) && Number.isInteger(link?.target),
      )
    ) {
      throw new Error("Invalid link prediction response.");
    }
    return data as LinkPredictionResponse;
  }

  private async post(action: string, body: unknown): Promise<any> {
    const response = await fetch(this.buildUrl(action), {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return this.readJson(response, "Model request failed");
  }

  private async readJson(response: Response, prefix: string): Promise<any> {
    const text = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!response.ok) {
      const detail =
        data !== null && typeof data.error === "string"
          ? data.error
          : `HTTP ${response.status}`;
      throw new Error(`${prefix}: ${detail}`);
    }
    if (data === null || typeof data !== "object") {
      throw new Error(`${prefix}: the server returned invalid JSON.`);
    }
    return data;
  }

  private authHeaders(): Record<string, string> {
    return this.userToken === null
      ? {}
      : { Authorization: "Bearer " + this.userToken };
  }

  private buildUrl(action: string): string {
    const separator = this.backendUrl.includes("?") ? "&" : "?";
    return this.backendUrl + separator + "action=" + encodeURIComponent(action);
  }
}
