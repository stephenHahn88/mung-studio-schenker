import { resolveBackendUrl } from "../../pages/simple-backend/resolveBackendUrl";

export interface Yolo26Prediction {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly classId: number;
  readonly rawClassName: string;
  readonly className: string;
  readonly confidence: number;
  readonly source: SymbolDetectionSource;
  readonly modelKey: string;
  readonly modelLabel: string;
  readonly backend: DetectionModelBackend;
}

export interface Yolo26DetectionResponse {
  readonly model: string;
  readonly device: string;
  readonly options: SymbolDetectionRunOptions;
  readonly models: {
    readonly large: DetectionModelMetadata | null;
    readonly small: DetectionModelMetadata | null;
  };
  readonly largeCount: number;
  readonly tiledCount: number;
  readonly count: number;
  readonly image: {
    readonly width: number;
    readonly height: number;
  };
  readonly region?: null | {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly predictions: Yolo26Prediction[];
}

export type SymbolDetectionSource = "large" | "small";

export type DetectionModelBackend = "yolo" | "detr" | "rfdetr" | "ensemble";

export type DetectionModelRole = "large" | "small";

export interface DetectionModelMetadata {
  readonly key: string;
  readonly label: string;
  readonly role: DetectionModelRole;
  readonly backend: DetectionModelBackend;
  readonly path?: string;
  readonly available?: boolean;
  readonly candidatePaths?: readonly string[];
  readonly tileOwnership?: "legacy_margin" | "center_voronoi" | null;
}

export interface DetectionModelOption {
  readonly key: string;
  readonly label: string;
  readonly role: DetectionModelRole;
  readonly backend: DetectionModelBackend;
}

export const DETECTION_MODEL_OPTIONS: DetectionModelOption[] = [
  {
    key: "yolo26l_all9_fixed_ep100_tiled",
    label: "YOLO26L all-9 fixed epoch 100 (center-owned tiles)",
    role: "small",
    backend: "yolo",
  },
  {
    key: "yolo26l_large_fullwidth_7pages_pre",
    label: "YOLO26L, 7 pages",
    role: "large",
    backend: "yolo",
  },
  {
    key: "yolo26l_tiled_7pages_pre",
    label: "YOLO26L, 7 pages",
    role: "small",
    backend: "yolo",
  },
  {
    key: "yolo26l_large_fullwidth_9pages_ep300",
    label: "YOLO26L, 9 pages, 300 epochs",
    role: "large",
    backend: "yolo",
  },
  {
    key: "yolo26l_tiled_9pages_ep300",
    label: "YOLO26L, 9 pages, 300 epochs",
    role: "small",
    backend: "yolo",
  },
  {
    key: "yolo26l_tiled_9pages_ep200",
    label: "YOLO26L, 9 pages, 200 epochs",
    role: "small",
    backend: "yolo",
  },
  {
    key: "detr_large_fullwidth_9pages_ep90",
    label: "DETR, 9 pages, 90 epochs",
    role: "large",
    backend: "detr",
  },
  {
    key: "detr_large_fullwidth_9pages_boxfocused_ep200",
    label: "DETR box-focused, 9 pages, 200 epochs",
    role: "large",
    backend: "detr",
  },
  {
    key: "detr_large_9pages_copypaste_ep50",
    label: "DETR copy-paste, 9 pages, 50 epochs",
    role: "large",
    backend: "detr",
  },
  {
    key: "rfdetr_large_9pages_medium_ep120",
    label: "RF-DETR Medium @1536, 9 pages",
    role: "large",
    backend: "rfdetr",
  },
  {
    key: "rfdetr_large_9pages_large2048_ep120",
    label: "RF-DETR Large @2048, 9 pages",
    role: "large",
    backend: "rfdetr",
  },
  {
    key: "detr_large_9pages_plus50",
    label: "DETR, 9 pages, 200 epochs",
    role: "large",
    backend: "detr",
  },
  {
    key: "detr_tiled_9pages_plus50",
    label: "DETR, 9 pages, 170 epochs",
    role: "small",
    backend: "detr",
  },
  {
    key: "yolo_rfdetr_small_ensemble",
    label: "YOLO + RF-DETR ensemble (slower, opt-in)",
    role: "small",
    backend: "ensemble",
  },
  {
    key: "musvit_large_ensemble",
    label: "5-model MuSViT ensemble (best quality, slower)",
    role: "large",
    backend: "ensemble",
  },
  {
    key: "rfdetr_all9_musvit_inv_1536",
    label: "MuSViT-RF-DETR inverted @1536, 9 pages",
    role: "large",
    backend: "rfdetr",
  },
];

export const DEFAULT_LARGE_DETECTION_MODEL_KEY = "musvit_large_ensemble";

export const DEFAULT_SMALL_DETECTION_MODEL_KEY =
  "yolo26l_all9_fixed_ep100_tiled";

export interface Yolo26DetectionOptions {
  readonly largeConf: number;
  readonly largeImgsz: number;
  readonly stripWidth: number;
  readonly stripHeight: number;
  readonly stripStepX: number;
  readonly stripStepY: number;
  readonly tileConf: number;
  readonly tilePatch: number;
  readonly tileStep: number;
  readonly tileMargin: number;
  readonly sameClassIou: number;
  readonly sameClassAreaRatio: number;
  readonly xclassIou: number;
  readonly xclassAreaRatio: number;
}

export interface SymbolDetectionRunOptions extends Yolo26DetectionOptions {
  readonly largeModelKey: string;
  readonly smallModelKey: string;
  readonly runLarge: boolean;
  readonly runSmall: boolean;
  readonly deduplicate: boolean;
  readonly roiLeft?: number;
  readonly roiTop?: number;
  readonly roiWidth?: number;
  readonly roiHeight?: number;
}

export const DEFAULT_YOLO26_DETECTION_OPTIONS: Yolo26DetectionOptions = {
  largeConf: 0.4,
  largeImgsz: 3072,
  stripWidth: 0,
  stripHeight: 768,
  stripStepX: 1,
  stripStepY: 384,
  tileConf: 0.15,
  tilePatch: 1216,
  tileStep: 960,
  tileMargin: 128,
  sameClassIou: 0.3,
  sameClassAreaRatio: 0.5,
  xclassIou: 0.75,
  xclassAreaRatio: 0.7,
};

// Same localStorage key the simple-backend connection atom persists the token
// under (see SimpleBackendConnection.ts). Read directly so detection requests
// can authenticate without threading the jotai atom through every call site.
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

export class Yolo26DetectionApi {
  private readonly backendUrl: string;
  private readonly userToken: string | null;

  constructor() {
    const url = resolveBackendUrl(
      process.env["YOLO26_BACKEND_URL"] ||
        process.env["SIMPLE_PHP_BACKEND_URL"] ||
        "SAME_ORIGIN",
    );
    if (url === undefined) {
      throw new Error("YOLO26 backend URL is not specified.");
    }
    this.backendUrl = url;
    this.userToken = readPersistedUserToken();
  }

  private authHeaders(): Record<string, string> {
    return this.userToken === null
      ? {}
      : { Authorization: "Bearer " + this.userToken };
  }

  public static isConfigured(): boolean {
    return true;
  }

  public async detectImageUrl(
    imageUrl: string,
    options: SymbolDetectionRunOptions,
  ): Promise<Yolo26DetectionResponse> {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(
        "Could not read the current background image: " +
          (await imageResponse.text()),
      );
    }

    const imageBlob = await imageResponse.blob();
    const body = new FormData();
    body.append("image", imageBlob, "mung-studio-page.png");
    for (const [key, value] of Object.entries(options)) {
      body.append(key, String(value));
    }

    const response = await fetch(this.buildUrl("detect-symbols"), {
      method: "POST",
      headers: this.authHeaders(),
      body,
    });
    if (!response.ok) {
      const data = await response.text();
      throw new Error("YOLO26 detection failed: " + data);
    }

    return (await response.json()) as Yolo26DetectionResponse;
  }

  public async listDetectionModels(): Promise<DetectionModelMetadata[]> {
    const response = await fetch(this.buildUrl("list-detection-models"), {
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      const data = await response.text();
      throw new Error("Could not list detection models: " + data);
    }
    const data = (await response.json()) as {
      readonly models?: DetectionModelMetadata[];
    };
    return data.models ?? [];
  }

  /**
   * Predict directed syntax edges among all symbols of a saved document, using
   * the server-side learned relation model. Returns node-id pairs to link.
   * Note: inference only reads the document's last-saved mung.xml.
   */
  public async assembleEdges(
    documentName: string,
    threshold?: number,
  ): Promise<{
    edges: { source: number; target: number; confidence: number }[];
    edgeCount?: number;
    smallCount?: number;
    pairCount?: number;
  }> {
    let url =
      this.buildUrl("assemble-edges") +
      "&document=" +
      encodeURIComponent(documentName);
    if (threshold !== undefined) url += "&threshold=" + String(threshold);
    const response = await fetch(url, { headers: this.authHeaders() });
    if (!response.ok) {
      throw new Error("Edge assembly failed: " + (await response.text()));
    }
    return await response.json();
  }

  /**
   * Trigger an off-site Google Drive backup of ALL documents on the server
   * (the "Backup now" button in the sidebar). Requires a user token.
   */
  public async backupDocuments(): Promise<{
    ok: boolean;
    log?: string;
    error?: string;
  }> {
    const response = await fetch(this.buildUrl("backup-documents"), {
      method: "POST",
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error("Backup failed: " + (await response.text()));
    }
    return await response.json();
  }

  private buildUrl(action: string): string {
    const separator = this.backendUrl.includes("?") ? "&" : "?";
    return this.backendUrl + separator + "action=" + encodeURIComponent(action);
  }
}
