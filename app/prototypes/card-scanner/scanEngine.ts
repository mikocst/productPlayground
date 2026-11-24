// Main-thread side of the scan worker: one shared worker, typed messages, one frame in flight at a time.
//
// Backpressure: while a frame is being analyzed, new frames are dropped (`analyze` resolves null), so the
// camera tick can fire every 40 ms without building a backlog.
// Stale results: every request belongs to a session; once the scan view closes its session, late replies
// resolve null instead of reaching a view that has moved on. That check lives here, not in the worker,
// because only the page knows what the user is looking at.
// Lifetime: the worker (and its parsed index) stays alive WORKER_KEEP_ALIVE_MS after the last session
// closes, so scanning again doesn't re-download or re-parse the index.

import { WORKER_KEEP_ALIVE_MS } from "./data";
import type { V1Result } from "./engineV1";
import type { Rect } from "./geometry";
import type { Decision as V1Decision } from "./autoScanV1";
import type { FrameAnalysis } from "./types";

export type Engine = "v1" | "v2";

export type IndexInfo = {
  engine: Engine;
  entries: number;
  names?: number;
  printings?: number;
  bytes?: number;
  parseMs?: number;
  builtAt?: number;
  newestSet?: string;
};

export type WorkerRequest =
  | { type: "init"; engine: Engine }
  | { type: "reset" }
  | { type: "frame"; id: number; engine: Engine; width: number; height: number; pixels: ArrayBuffer; guide: Rect }
  | { type: "photo"; id: number; engine: Engine; width: number; height: number; pixels: ArrayBuffer };

export type FrameReply = { engine: "v2"; analysis: FrameAnalysis } | { engine: "v1"; result: V1Result; ms: number };
export type PhotoReply = { engine: "v2"; analysis: FrameAnalysis } | { engine: "v1"; decision: V1Decision };

export type WorkerResponse =
  | { type: "ready"; info: IndexInfo }
  | { type: "failed"; engine: Engine; message: string }
  | { type: "frame"; id: number; reply: FrameReply }
  | { type: "photo"; id: number; reply: PhotoReply }
  | { type: "error"; id: number; message: string };

type Pending = { session: ScanSession; resolve: (value: FrameReply | PhotoReply | null) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let sessions = 0;
let killTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const ready = new Map<Engine, { promise: Promise<IndexInfo>; resolve: (info: IndexInfo) => void; reject: (error: Error) => void }>();

function dispose(reason: string) {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error(reason));
  pending.clear();
  for (const r of ready.values()) r.reject(new Error(reason));
  ready.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
  created.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === "ready") return ready.get(message.info.engine)?.resolve(message.info);
    if (message.type === "failed") {
      const r = ready.get(message.engine);
      ready.delete(message.engine);
      return r?.reject(new Error(message.message));
    }
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    if (p.session.closed) return p.resolve(null);
    if (message.type === "error") p.reject(new Error(message.message));
    else p.resolve(message.reply);
  };
  created.onerror = () => dispose("The scanner stopped unexpectedly.");
  worker = created;
  return created;
}

function loadEngine(engine: Engine): Promise<IndexInfo> {
  const known = ready.get(engine);
  if (known) return known.promise;
  let resolve!: (info: IndexInfo) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<IndexInfo>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  ready.set(engine, { promise, resolve, reject });
  getWorker().postMessage({ type: "init", engine } satisfies WorkerRequest);
  return promise;
}

/** One scan view's use of the worker. Close it on unmount. */
export class ScanSession {
  closed = false;
  private inFlight = false;

  constructor(readonly engine: Engine) {
    sessions++;
    if (killTimer) clearTimeout(killTimer);
    killTimer = null;
    getWorker().postMessage({ type: "reset" } satisfies WorkerRequest);
  }

  ready(): Promise<IndexInfo> {
    return loadEngine(this.engine);
  }

  get busy(): boolean {
    return this.inFlight;
  }

  private request<T extends FrameReply | PhotoReply>(message: WorkerRequest & { id: number; pixels: ArrayBuffer }): Promise<T | null> {
    if (this.closed) return Promise.resolve(null);
    this.inFlight = true;
    return new Promise<T | null>((resolve, reject) => {
      pending.set(message.id, { session: this, resolve: resolve as Pending["resolve"], reject });
      getWorker().postMessage(message, [message.pixels]);
    }).finally(() => {
      this.inFlight = false;
    });
  }

  /** Analyzes one camera frame, or resolves null at once if a frame is already in flight. */
  analyze(frame: ImageData, guide: Rect): Promise<FrameReply | null> {
    if (this.inFlight) return Promise.resolve(null);
    const pixels = frame.data.buffer as ArrayBuffer;
    return this.request<FrameReply>({ type: "frame", id: nextId++, engine: this.engine, width: frame.width, height: frame.height, pixels, guide });
  }

  /** Matches an uploaded photo through the same pipeline (waits for any frame in flight first). */
  async photo(image: ImageData): Promise<PhotoReply | null> {
    while (this.inFlight) await new Promise((r) => setTimeout(r, 20));
    const pixels = image.data.buffer as ArrayBuffer;
    return this.request<PhotoReply>({ type: "photo", id: nextId++, engine: this.engine, width: image.width, height: image.height, pixels });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    sessions--;
    if (sessions > 0) return;
    killTimer = setTimeout(() => {
      killTimer = null;
      if (sessions === 0) dispose("closed");
    }, WORKER_KEEP_ALIVE_MS);
  }
}
