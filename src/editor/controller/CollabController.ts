import { atom, Atom } from "jotai";
import { JotaiStore } from "../model/JotaiStore";
import { NotationGraphStore } from "../model/notation-graph-store/NotationGraphStore";
import { SelectionStore } from "../model/SelectionStore";

/** Configuration for joining the collaboration session of a document. */
export interface CollabConfig {
  /** Backend base URL ending with "/" (e.g. "https://host/"). */
  readonly backendUrl: string;
  /** Auth token (Bearer). */
  readonly token: string;
  /** Document name (the collaboration room). */
  readonly documentName: string;
  /** Display name of the local user. */
  readonly userName: string;
}

/** One collaborator currently on the document. */
export interface Peer {
  readonly clientId: string;
  readonly name: string;
  readonly color: string;
  readonly cursor?: { x: number; y: number } | null;
  readonly selection?: readonly number[] | null;
}

const PALETTE = [
  "#e5484d",
  "#0091ff",
  "#30a46c",
  "#f76b15",
  "#8e4ec6",
  "#e93d82",
  "#12a594",
  "#ffb224",
  "#5b5bd6",
  "#e54666",
];

function randomId(): string {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  );
}

/**
 * Real-time collaboration on one document: sends local graph operations and
 * presence to the backend, applies remote operations and exposes the other
 * collaborators. Reconnects after 1.5 s when the stream drops.
 */
export class CollabController {
  private readonly clientId = randomId();
  private color = PALETTE[0];
  private stopped = false;
  private abort: AbortController | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // node updates coalesced during drags
  private pendingUpdates = new Map<number, any>();
  private updateFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private postQueue: Promise<void> = Promise.resolve();
  private lastSeenSeq = 0;
  private pendingServerOps = new Map<number, any>();

  private localCursor: { x: number; y: number } | null = null;
  private presenceSendScheduled = false;
  private unsubSelection: (() => void) | null = null;

  private readonly peersBaseAtom = atom<readonly Peer[]>([]);
  /** Read-only atom of the other collaborators on this document. */
  public readonly peersAtom: Atom<readonly Peer[]> = atom((get) =>
    get(this.peersBaseAtom),
  );
  /** The local client's color. */
  public get selfColor(): string {
    return this.color;
  }
  public get selfClientId(): string {
    return this.clientId;
  }

  constructor(
    private readonly jotaiStore: JotaiStore,
    private readonly notationGraphStore: NotationGraphStore,
    private readonly selectionStore: SelectionStore,
    private readonly config: CollabConfig,
  ) {
    // color derived from the client id
    let h = 0;
    for (const c of this.clientId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    this.color = PALETTE[h % PALETTE.length];
  }

  /** Begin collaborating: attach op sink, open the stream, start heartbeats. */
  public start(): void {
    this.notationGraphStore.opSink = (op) => this.onLocalOp(op);
    this.openStream();
    this.heartbeatTimer = setInterval(() => this.sendPresence(), 4000);
    this.unsubSelection = this.jotaiStore.sub(
      this.selectionStore.selectedNodeIdsAtom,
      () => this.schedulePresence(),
    );
    this.sendPresence();
  }

  /** Tear down (on editor unmount). */
  public stop(): void {
    // Submit already accepted edits before detaching the document.
    this.flushUpdates();
    this.stopped = true;
    if (this.notationGraphStore.opSink) this.notationGraphStore.opSink = null;
    this.abort?.abort();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.updateFlushTimer) clearTimeout(this.updateFlushTimer);
    this.unsubSelection?.();
  }

  /** Called by the scene overlay on mouse move (image-space coordinates). */
  public reportCursor(x: number | null, y: number | null): void {
    this.localCursor = x === null || y === null ? null : { x, y };
    this.schedulePresence();
  }

  // ---- local -> server -------------------------------------------------
  private onLocalOp(op: any): void {
    if (op.t === "updateNode") {
      // coalesce rapid drags: keep only the latest per node, flush at 80ms
      this.pendingUpdates.set(op.node.id, op);
      if (this.updateFlushTimer === null) {
        this.updateFlushTimer = setTimeout(() => this.flushUpdates(), 80);
      }
      return;
    }
    if (op.t === "removeNode" || op.t === "removeNodeWithLinks") {
      this.pendingUpdates.delete(op.id); // cancel stale drag for a deleted node
    }
    this.flushUpdates(); // preserve ordering: pending moves go before this op
    this.postOp(op);
  }

  private flushUpdates(): void {
    if (this.updateFlushTimer) {
      clearTimeout(this.updateFlushTimer);
      this.updateFlushTimer = null;
    }
    const ops = [...this.pendingUpdates.values()];
    this.pendingUpdates.clear();
    for (const op of ops) this.postOp(op);
  }

  private postOp(op: any): void {
    if (this.stopped) return;
    // Submissions are sent one at a time, in order.
    const body = JSON.stringify({ clientId: this.clientId, op });
    this.postQueue = this.postQueue
      .then(async () => {
        const response = await fetch(this.url("collab-op"), {
          method: "POST",
          headers: {
            Authorization: "Bearer " + this.config.token,
            "Content-Type": "application/json",
          },
          body,
        });
        if (!response.ok)
          throw new Error(
            `Collaboration operation failed (${response.status}).`,
          );
      })
      .catch((error) => {
        console.warn(
          "Could not synchronize an edit; check the saved document before continuing collaboration.",
          error,
        );
      });
  }

  private schedulePresence(): void {
    if (this.presenceSendScheduled) return;
    this.presenceSendScheduled = true;
    setTimeout(() => {
      this.presenceSendScheduled = false;
      this.sendPresence();
    }, 100);
  }

  private sendPresence(): void {
    if (this.stopped) return;
    fetch(this.url("collab-presence"), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.config.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: this.clientId,
        name: this.config.userName,
        color: this.color,
        cursor: this.localCursor,
        selection: this.selectionStore.selectedNodeIds,
      }),
    }).catch(() => {});
  }

  // ---- server -> local (SSE via fetch stream) --------------------------
  private async openStream(): Promise<void> {
    while (!this.stopped) {
      this.abort = new AbortController();
      try {
        const resp = await fetch(this.url("collab-stream"), {
          headers: { Authorization: "Bearer " + this.config.token },
          signal: this.abort.signal,
        });
        if (!resp.ok || !resp.body) throw new Error("stream " + resp.status);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!this.stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            for (const line of block.split("\n")) {
              if (line.startsWith("data:")) {
                const json = line.slice(5).trim();
                if (json) this.handleEvent(JSON.parse(json));
              }
            }
          }
        }
      } catch (e) {
        if (this.stopped) return;
      }
      // reconnect after a short delay
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  private handleEvent(ev: any): void {
    if (ev.type === "init") {
      // On reconnect, replay only entries newer than the last applied seq.
      const entries = [...(ev.oplog ?? [])].sort((a, b) => a.seq - b.seq);
      for (const entry of entries) {
        if (!Number.isSafeInteger(entry.seq) || entry.seq <= this.lastSeenSeq)
          continue;
        this.applyServerOperation(entry);
        this.lastSeenSeq = entry.seq;
      }
      if (Number.isSafeInteger(ev.seq)) {
        this.lastSeenSeq = Math.max(this.lastSeenSeq, ev.seq);
      }
      for (const seq of this.pendingServerOps.keys()) {
        if (seq <= this.lastSeenSeq) this.pendingServerOps.delete(seq);
      }
      this.drainServerOperations();
      this.setPeers(ev.users ?? []);
    } else if (ev.type === "op") {
      if (!Number.isSafeInteger(ev.seq) || ev.seq <= this.lastSeenSeq) return;
      this.pendingServerOps.set(ev.seq, ev);
      this.drainServerOperations();
    } else if (ev.type === "presence") {
      this.setPeers(ev.users ?? []);
    }
  }

  private drainServerOperations(): void {
    // Operations can arrive out of order; apply them in seq order.
    while (this.pendingServerOps.has(this.lastSeenSeq + 1)) {
      const seq = this.lastSeenSeq + 1;
      const entry = this.pendingServerOps.get(seq);
      this.applyServerOperation(entry);
      this.pendingServerOps.delete(seq);
      this.lastSeenSeq = seq;
    }
  }

  private applyServerOperation(entry: any): void {
    // Time-group patches, including our own, are applied in server order.
    if (entry.op?.t === "patchTimeGroups" || entry.clientId !== this.clientId) {
      this.notationGraphStore.applyRemoteOp(entry.op);
    }
  }

  private setPeers(users: any[]): void {
    const peers = users.filter((u) => u.clientId !== this.clientId);
    this.jotaiStore.set(this.peersBaseAtom, peers as readonly Peer[]);
  }

  private url(action: string): string {
    return (
      this.config.backendUrl +
      "?action=" +
      action +
      "&document=" +
      encodeURIComponent(this.config.documentName) +
      "&clientId=" +
      encodeURIComponent(this.clientId) +
      "&name=" +
      encodeURIComponent(this.config.userName) +
      "&color=" +
      encodeURIComponent(this.color)
    );
  }
}
