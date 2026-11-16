import type { SimpleBackendConnection } from "./SimpleBackendConnection";
import {
  DocumentConversionResult,
  readConversionError,
  readDocumentConversion,
} from "./DocumentConversion";
import {
  DocStatus,
  DocumentStage,
  DocumentStagePatch,
  DocumentStages,
  readDocumentStages,
  readSavedDocumentStages,
} from "./DocumentWorkflow";
export type { DocStatus } from "./DocumentWorkflow";

export interface Document {
  readonly name: string;
  readonly hasImage: boolean;
  readonly hasOriginalImage?: boolean;
  readonly modifiedAt: string;
  readonly status?: DocStatus;
  readonly annotator?: string;
  readonly stages?: DocumentStages;
  readonly workflowStatusError?: string;
  readonly commentCount?: number;
  readonly unresolvedCommentCount?: number;
}

export interface ReviewComment {
  readonly id: string;
  readonly parentId?: string | null;
  readonly author: string;
  readonly text: string;
  readonly createdAt: string;
  readonly resolved: boolean;
  readonly resolvedBy: string;
  readonly resolvedAt: string | null;
}

export interface WhoamiResponse {
  /**
   * Name of the authenticated user
   */
  readonly name: string;
}

export interface CustomClassDefinition {
  readonly name: string;
  readonly addedBy: string;
  readonly addedAt: string;
}

export interface AddCustomClassResponse {
  readonly ok: boolean;
  readonly created: boolean;
  readonly class: CustomClassDefinition;
  readonly classes: CustomClassDefinition[];
}

export interface ClassCatalogResponse {
  readonly classes: CustomClassDefinition[];
  readonly colorOverrides: Readonly<Record<string, string>>;
}

export interface UpdateClassCatalogResponse extends ClassCatalogResponse {
  readonly ok: boolean;
}

export class SimpleBackendApi {
  private readonly connection: SimpleBackendConnection;

  constructor(connection: SimpleBackendConnection) {
    this.connection = connection;
  }

  private buildUrl(action: string, document: string | null = null): string {
    const urlWithAction =
      this.connection.backendUrl + "?action=" + encodeURIComponent(action);

    if (document === null) {
      return urlWithAction;
    }

    return urlWithAction + "&document=" + encodeURIComponent(document);
  }

  public async whoami(): Promise<WhoamiResponse> {
    const response = await fetch(this.buildUrl("whoami"), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.connection.userToken,
      },
    });
    if (response.status === 401) {
      throw new Error("Invalid user token.");
    }
    if (!response.ok) {
      throw new Error("Unexpected response: " + (await response.text()));
    }
    const data = await response.json();
    return data as WhoamiResponse;
  }

  public async listDocuments(): Promise<Document[]> {
    const response = await fetch(this.buildUrl("list-documents"), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.connection.userToken,
      },
    });
    if (response.status === 401) {
      throw new Error("Invalid user token.");
    }
    if (!response.ok) {
      throw new Error("Unexpected response: " + (await response.text()));
    }
    const data = await response.json();
    return (data.documents as Document[]).map((document) => ({
      ...document,
      stages: readDocumentStages(document),
    }));
  }

  public async convertDocument(
    documentName: string,
    signal?: AbortSignal,
  ): Promise<DocumentConversionResult> {
    if (!this.connection.userToken)
      throw new Error("Sign in from the directory to convert this page.");
    const response = await fetch(
      this.buildUrl("convert-document", documentName),
      {
        method: "POST",
        headers: { Authorization: "Bearer " + this.connection.userToken },
        signal,
      },
    );
    if (!response.ok) throw await readConversionError(response);
    return readDocumentConversion(await response.json());
  }

  public async getClassCatalog(): Promise<ClassCatalogResponse> {
    const response = await fetch(this.buildUrl("list-custom-classes"), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.connection.userToken,
      },
    });
    if (response.status === 401) {
      throw new Error("Invalid user token.");
    }
    if (!response.ok) {
      throw new Error("Unexpected response: " + (await response.text()));
    }
    const data = await response.json();
    return {
      classes: data.classes as CustomClassDefinition[],
      colorOverrides: data.colorOverrides || {},
    };
  }

  public async listCustomClasses(): Promise<CustomClassDefinition[]> {
    return (await this.getClassCatalog()).classes;
  }

  public async addCustomClass(
    className: string,
  ): Promise<AddCustomClassResponse> {
    const response = await fetch(this.buildUrl("add-custom-class"), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.connection.userToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: className }),
    });
    if (response.status === 401) {
      throw new Error("Invalid user token.");
    }
    if (!response.ok) {
      const body = await response.text();
      try {
        const parsed = JSON.parse(body);
        throw new Error(parsed.error || body);
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error("Unexpected response: " + body);
        }
        throw error;
      }
    }
    return (await response.json()) as AddCustomClassResponse;
  }

  public async setClassColor(
    className: string,
    color: string | null,
  ): Promise<UpdateClassCatalogResponse> {
    const action = color === null ? "clear-class-color" : "set-class-color";
    const response = await fetch(this.buildUrl(action), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.connection.userToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ className, color }),
    });
    if (response.status === 401) throw new Error("Invalid user token.");
    if (!response.ok) {
      const body = await response.text();
      try {
        const parsed = JSON.parse(body);
        throw new Error(parsed.error || body);
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error("Unexpected response: " + body);
        }
        throw error;
      }
    }
    return (await response.json()) as UpdateClassCatalogResponse;
  }

  public async setDocumentStatus(
    documentName: string,
    stage: DocumentStage,
    patch: DocumentStagePatch,
  ): Promise<DocumentStages> {
    const response = await fetch(
      this.buildUrl("set-doc-status", documentName),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.connection.userToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ stage, ...patch }),
      },
    );
    if (response.status === 401) {
      throw new Error("Invalid user token.");
    }
    if (!response.ok) {
      throw new Error("Unexpected response: " + (await response.text()));
    }
    return readSavedDocumentStages(await response.json());
  }

  public async getDocumentMung(documentName: string): Promise<string> {
    const response = await fetch(
      this.buildUrl("get-document-mung", documentName),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.connection.userToken,
        },
      },
    );
    if (response.status === 401) {
      throw new Error("Invalid user token.");
    }
    if (!response.ok) {
      throw new Error("Unexpected response: " + (await response.text()));
    }
    return await response.text();
  }

  public async getDocumentImage(documentName: string): Promise<Blob> {
    const response = await fetch(
      this.buildUrl("get-document-image", documentName),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.connection.userToken,
        },
      },
    );
    if (response.status === 401) {
      throw new Error("Invalid user token.");
    }
    if (!response.ok) {
      throw new Error("Unexpected response: " + (await response.text()));
    }
    return await response.blob();
  }

  public async getDocumentOriginalImage(documentName: string): Promise<Blob> {
    const response = await fetch(
      this.buildUrl("get-document-original", documentName),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.connection.userToken,
        },
      },
    );
    if (response.status === 401) throw new Error("Invalid user token.");
    if (response.status === 404) {
      throw new Error("The original image is not available for this page.");
    }
    if (!response.ok) {
      throw new Error("Unexpected response: " + (await response.text()));
    }
    return await response.blob();
  }

  public async listReviewComments(
    documentName: string,
  ): Promise<ReviewComment[]> {
    const response = await fetch(
      this.buildUrl("list-review-comments", documentName),
      {
        method: "POST",
        headers: { Authorization: "Bearer " + this.connection.userToken },
      },
    );
    if (response.status === 401) throw new Error("Invalid user token.");
    if (!response.ok) {
      throw new Error("Unexpected response: " + (await response.text()));
    }
    return ((await response.json()).comments ?? []) as ReviewComment[];
  }

  public async addReviewComment(
    documentName: string,
    text: string,
    parentId: string | null = null,
  ): Promise<ReviewComment> {
    const response = await fetch(
      this.buildUrl("add-review-comment", documentName),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.connection.userToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, parentId }),
      },
    );
    if (response.status === 401) throw new Error("Invalid user token.");
    if (!response.ok) {
      const body = await response.text();
      try {
        throw new Error(JSON.parse(body).error || body);
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error("Unexpected response: " + body);
        }
        throw error;
      }
    }
    return (await response.json()).comment as ReviewComment;
  }

  public async setReviewCommentResolved(
    documentName: string,
    id: string,
    resolved: boolean,
  ): Promise<ReviewComment> {
    const response = await fetch(
      this.buildUrl("set-review-comment-resolved", documentName),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.connection.userToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, resolved }),
      },
    );
    if (response.status === 401) throw new Error("Invalid user token.");
    if (!response.ok) {
      const body = await response.text();
      try {
        throw new Error(JSON.parse(body).error || body);
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error("Unexpected response: " + body);
        }
        throw error;
      }
    }
    return (await response.json()).comment as ReviewComment;
  }

  public async uploadDocumentMung(
    documentName: string,
    mungXmlString: string,
  ): Promise<void> {
    const response = await fetch(
      this.buildUrl("upload-document-mung", documentName),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/mung+xml",
          Authorization: "Bearer " + this.connection.userToken,
        },
        body: mungXmlString,
      },
    );
    if (response.status === 401) {
      throw new Error("Invalid user token.");
    }
    if (!response.ok) {
      throw new Error("Unexpected response: " + (await response.text()));
    }
  }
}
