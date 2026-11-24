// Scanner v2 per-frame pipeline: find the card, straighten and hash it, search the index. Pure (no DOM), so
// the worker and the offline eval (scripts/eval-scanner.ts) run exactly the same code.
//
//   tracked quad from the last confident frame? → hash it → still confident? done
//   else outlines (outline.ts) [+ the guide box if no outline and it has texture] → hash each → search
//   → best not confident? nudge its edges, re-hashing against its nearest entries only → final full search

import { FramePlanes, hashQuad, imageQuad, type Plane, type Quad } from "@/lib/cards/card-hash";
import { oracleIdOf, resolvePrinting, search, searchEntries, type CardIndex, type SearchResult } from "@/lib/cards/card-index";
import { CONFIDENT_DISTANCE, CONFIDENT_MARGIN, GUESS_DISTANCE, GUIDE_FALLBACK_TEXTURE, PRINTING_SPREAD, REFINE_EDGE_STEPS, REFINE_NEAREST, REFINE_PASSES } from "./data";
import type { Rect } from "./geometry";
import { detectOutlines } from "./outline";
import type { FrameAnalysis, FrameMatch, QuadSource } from "./types";

/** The last confidently matched quad, reused first on the next frame of the same size. */
export type Tracker = { quad: Quad; width: number; height: number } | null;

type Tried = { quad: Quad; hash: Uint32Array; result: SearchResult; source: QuadSource };

const margin = (r: SearchResult) => (r.best ? (r.runnerUp?.distance ?? 256) - r.best.distance : 0);

export function isConfident(r: SearchResult): boolean {
  return !!r.best && r.best.distance <= CONFIDENT_DISTANCE && margin(r) >= CONFIDENT_MARGIN;
}

const better = (a: SearchResult, b: SearchResult) => (a.best?.distance ?? 257) - margin(a) * 0.25 < (b.best?.distance ?? 257) - margin(b) * 0.25;

function rectQuad(r: Rect): Quad {
  return [r.x, r.y, r.x + r.width, r.y, r.x + r.width, r.y + r.height, r.x, r.y + r.height];
}

/** Luma standard deviation inside a rectangle (frame pixels), sampled on a coarse grid of a plane shrunk by `factor`. */
function texture(plane: Plane, factor: number, frame: Rect): number {
  const r = { x: frame.x / factor, y: frame.y / factor, width: frame.width / factor, height: frame.height / factor };
  let sum = 0, sq = 0, n = 0;
  const step = Math.max(1, Math.floor(Math.min(r.width, r.height) / 40));
  for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(plane.height, r.y + r.height); y += step) {
    for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(plane.width, r.x + r.width); x += step) {
      const v = plane.data[y * plane.width + x];
      sum += v;
      sq += v * v;
      n++;
    }
  }
  return n ? Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) : 0;
}

/** Moves one edge (0 top, 1 right, 2 bottom, 3 left) along its outward normal by `amount` pixels. */
function moveEdge(q: Quad, edge: number, amount: number): Quad {
  const out = [...q];
  const a = edge, b = (edge + 1) % 4;
  const ax = q[a * 2], ay = q[a * 2 + 1], bx = q[b * 2], by = q[b * 2 + 1];
  const length = Math.hypot(bx - ax, by - ay) || 1;
  // Clockwise corners in y-down coordinates: the outward normal of A→B is (dy, −dx).
  const nx = (by - ay) / length, ny = -(bx - ax) / length;
  out[a * 2] += nx * amount;
  out[a * 2 + 1] += ny * amount;
  out[b * 2] += nx * amount;
  out[b * 2 + 1] += ny * amount;
  return out as unknown as Quad;
}

function cardHeight(q: Quad): number {
  return (Math.hypot(q[6] - q[0], q[7] - q[1]) + Math.hypot(q[4] - q[2], q[5] - q[3])) / 2;
}

/** Two passes of per-edge nudges, each kept when it brings the nearest entries closer. */
function refine(index: CardIndex, planes: FramePlanes, start: Tried): Tried {
  const entries = start.result.nearest.map((hit) => hit.entry);
  if (!entries.length) return start;
  let quad = start.quad;
  let bestDistance = searchEntries(index, start.hash, entries).best?.distance ?? 257;
  const height = cardHeight(quad);
  let edges = [0, 1, 2, 3];
  for (let pass = 0; pass < REFINE_PASSES && edges.length; pass++) {
    const moved: number[] = [];
    for (const edge of edges) {
      let edgeBest: Quad | null = null;
      for (const step of REFINE_EDGE_STEPS) {
        const candidate = moveEdge(quad, edge, step * height * (pass === 0 ? 1 : 0.5));
        const d = searchEntries(index, hashQuad(planes, candidate), entries).best?.distance ?? 257;
        if (d < bestDistance) {
          bestDistance = d;
          edgeBest = candidate;
        }
      }
      if (edgeBest) {
        quad = edgeBest;
        moved.push(edge);
      }
    }
    // The second pass only revisits edges that moved, with half-size steps.
    edges = moved;
  }
  // A full search only pays off if the nudged quad could become a match or a guess.
  if (quad === start.quad || bestDistance > GUESS_DISTANCE) return start;
  const hash = hashQuad(planes, quad);
  return { quad, hash, result: search(index, hash, REFINE_NEAREST), source: start.source };
}

function toMatch(index: CardIndex, tried: Tried): FrameMatch | null {
  const best = tried.result.best;
  if (!best) return null;
  const printing = resolvePrinting(index, tried.hash, best.nameIndex, PRINTING_SPREAD);
  return {
    nameIndex: best.nameIndex,
    oracleId: oracleIdOf(index, best.nameIndex),
    name: index.names[best.nameIndex],
    distance: best.distance,
    printingId: printing.printingId,
    set: printing.set,
    collector: printing.collector,
    printingCertain: printing.certain,
  };
}

function finish(index: CardIndex, tried: Tried | null, hasOutline: boolean, outlines: number, started: number): FrameAnalysis {
  const runnerUp = tried?.result.runnerUp;
  return {
    hasOutline,
    outlines,
    quad: tried?.quad ?? null,
    source: tried?.source ?? "none",
    best: tried ? toMatch(index, tried) : null,
    runnerUp: runnerUp ? { name: index.names[runnerUp.nameIndex], distance: runnerUp.distance } : null,
    confident: !!tried && isConfident(tried.result),
    ms: performance.now() - started,
  };
}

/**
 * Analyzes one camera frame (RGBA, already cropped around the guide). `guide` is the guide box in frame
 * pixels, used only as a fallback quad. Returns the analysis and the tracker for the next frame.
 */
export function analyzeFrame(
  index: CardIndex,
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  options: { guide?: Rect | null; tracker?: Tracker; wholeImage?: boolean } = {},
): { analysis: FrameAnalysis; tracker: Tracker } {
  const started = performance.now();
  const planes = new FramePlanes(rgba, width, height);
  const attempt = (quad: Quad, source: QuadSource): Tried => {
    const hash = hashQuad(planes, quad);
    return { quad, hash, result: search(index, hash, REFINE_NEAREST), source };
  };
  const track = (t: Tried | null): Tracker => (t && isConfident(t.result) ? { quad: t.quad, width, height } : null);

  const tracker = options.tracker;
  if (tracker && tracker.width === width && tracker.height === height) {
    const tracked = attempt(tracker.quad, "tracked");
    if (isConfident(tracked.result)) return { analysis: finish(index, tracked, true, 1, started), tracker: track(tracked) };
  }

  // Outlines come best first; stop at the first confident one (usually the first), so a clear card costs one search.
  const outlines = detectOutlines(rgba, width, height);
  const tried: Tried[] = [];
  for (const o of outlines) {
    const t = attempt(o.quad, "outline");
    tried.push(t);
    if (isConfident(t.result)) break;
  }
  if (options.wholeImage && !tried.some((t) => isConfident(t.result))) tried.push(attempt(imageQuad(width, height), "image"));
  if (!outlines.length && options.guide && texture(planes.any().plane, planes.any().factor, options.guide) >= GUIDE_FALLBACK_TEXTURE) {
    tried.push(attempt(rectQuad(options.guide), "guide"));
  }
  if (!tried.length) return { analysis: finish(index, null, false, 0, started), tracker: null };

  let best = tried.reduce((a, b) => (better(b.result, a.result) ? b : a));
  if (!isConfident(best.result)) best = refine(index, planes, best);
  return { analysis: finish(index, best, outlines.length > 0, outlines.length, started), tracker: track(best) };
}
