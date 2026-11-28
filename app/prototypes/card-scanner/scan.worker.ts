// Scan worker entry: loads the index itself, analyzes one posted frame at a time, and keeps the tracked
// quad between frames. Created by scanEngine.ts; all heavy work stays off the UI thread.

import { decodeIndex, type CardIndex } from "@/lib/cards/card-index";
import { CARD_INDEX_MANIFEST_URL } from "./data";
import { V1Engine } from "./engineV1";
import { analyzeFrame, type Tracker } from "./pipeline";
import type { Engine, IndexInfo, WorkerRequest, WorkerResponse } from "./scanEngine";

type Scope = { onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null; postMessage(message: WorkerResponse): void };
const scope = self as unknown as Scope;

const INDEX_FILE = /^card-index\.[0-9a-f]{16}\.bin$/;

let index: CardIndex | null = null;
let v1: V1Engine | null = null;
let tracker: Tracker = null;
const loading = new Map<Engine, Promise<IndexInfo>>();

async function loadV2(): Promise<IndexInfo> {
  // The manifest is revalidated every time; the content-hashed .bin it names is cached forever.
  const manifestResponse = await fetch(CARD_INDEX_MANIFEST_URL, { cache: "no-cache" });
  if (!manifestResponse.ok) throw new Error(`manifest ${manifestResponse.status}`);
  const manifest = (await manifestResponse.json()) as { file?: unknown };
  if (typeof manifest.file !== "string" || !INDEX_FILE.test(manifest.file)) throw new Error("manifest format");
  const response = await fetch(`/data/${manifest.file}`);
  if (!response.ok) throw new Error(`index ${response.status}`);
  const buffer = await response.arrayBuffer();
  const started = performance.now();
  index = decodeIndex(buffer);
  return {
    engine: "v2",
    entries: index.entries,
    names: index.names.length,
    printings: index.printIds.length / 16,
    bytes: index.bytes,
    parseMs: performance.now() - started,
    builtAt: index.builtAt,
    newestSet: index.newestSet,
  };
}

async function loadV1(): Promise<IndexInfo> {
  v1 ??= new V1Engine();
  const { entries } = await v1.load();
  return { engine: "v1", entries };
}

function load(engine: Engine): Promise<IndexInfo> {
  let promise = loading.get(engine);
  if (!promise) {
    promise = engine === "v2" ? loadV2() : loadV1();
    promise.catch(() => loading.delete(engine));
    loading.set(engine, promise);
  }
  return promise;
}

scope.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      scope.postMessage({ type: "ready", info: await load(message.engine) });
    } catch (error) {
      scope.postMessage({ type: "failed", engine: message.engine, message: error instanceof Error ? error.message : "index failed" });
    }
    return;
  }
  if (message.type === "reset") {
    tracker = null;
    v1?.reset();
    return;
  }
  try {
    await load(message.engine);
    const pixels = new Uint8ClampedArray(message.pixels);
    if (message.type === "frame") {
      if (message.engine === "v2") {
        const result = analyzeFrame(index!, pixels, message.width, message.height, { guide: message.guide, tracker });
        tracker = result.tracker;
        scope.postMessage({ type: "frame", id: message.id, reply: { engine: "v2", analysis: result.analysis } });
      } else {
        const started = performance.now();
        const result = v1!.analyze(pixels, message.width, message.height, message.guide);
        scope.postMessage({ type: "frame", id: message.id, reply: { engine: "v1", result, ms: performance.now() - started } });
      }
    } else if (message.engine === "v2") {
      const { analysis } = analyzeFrame(index!, pixels, message.width, message.height, { wholeImage: true });
      scope.postMessage({ type: "photo", id: message.id, reply: { engine: "v2", analysis } });
    } else {
      scope.postMessage({ type: "photo", id: message.id, reply: { engine: "v1", decision: v1!.photo(pixels, message.width, message.height) } });
    }
  } catch (error) {
    scope.postMessage({ type: "error", id: message.id, message: error instanceof Error ? error.message : "scan failed" });
  }
};
