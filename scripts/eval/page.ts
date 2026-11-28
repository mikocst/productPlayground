// Runs inside the eval's headless Chromium page (bundled by scripts/eval-scanner.ts). Renders synthetic
// camera frames and runs both scanner engines on them with the app's own modules.

import { hashCardPixels, homography, type Quad } from "@/lib/cards/card-hash";
import { decodeIndex, oracleIdOf, search, type CardIndex } from "@/lib/cards/card-index";
import { decidePhoto, EMPTY_SCAN, recordFrame, type Decision } from "@/app/prototypes/card-scanner/autoScan";
import { V1Engine } from "@/app/prototypes/card-scanner/engineV1";
import { detectOutlines } from "@/app/prototypes/card-scanner/outline";
import { analyzeFrame, type Tracker } from "@/app/prototypes/card-scanner/pipeline";
import type { Rect } from "@/app/prototypes/card-scanner/geometry";

export type Condition = {
  name: string;
  /** Card height as a fraction of the guide. */
  size: number;
  /** In-plane rotation, degrees. */
  rotate: number;
  /** Perspective: the top edge is this much narrower than the bottom (0.15 ≈ a 20° tilt toward the camera). */
  tilt: number;
  /** Center offset as a fraction of the guide. */
  offset: [number, number];
  blur: number;
  noise: number;
  glare: number;
  dim: number;
  sleeve: boolean;
  busy: boolean;
  /** Foil-like rainbow tint over the card (0–1). */
  foil?: number;
};

export type Scene = { rgba: Uint8ClampedArray; width: number; height: number; guide: Rect; truth: Quad | null };

let index: CardIndex | null = null;
let v1: V1Engine | null = null;
const images = new Map<string, ImageData>();

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export async function load() {
  const manifest = await (await fetch("/data/card-index.manifest.json")).json();
  const buffer = await (await fetch(`/data/${manifest.file}`)).arrayBuffer();
  const t = performance.now();
  index = decodeIndex(buffer);
  const parseMs = performance.now() - t;
  v1 = new V1Engine();
  await v1.load();
  return { entries: index.entries, names: index.names.length, bytes: index.bytes, parseMs };
}

export async function image(url: string): Promise<{ width: number; height: number }> {
  if (!images.has(url)) {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    images.set(url, ctx.getImageData(0, 0, bitmap.width, bitmap.height));
  }
  const im = images.get(url)!;
  return { width: im.width, height: im.height };
}

/** Phase 3 checkpoint: hash the clean scan with image-corner quads (no detection). */
export function hashOnly(url: string) {
  const im = images.get(url)!;
  const hash = hashCardPixels(im.data, im.width, im.height);
  const r = search(index!, hash, 0);
  const best = r.best!;
  return { oracleId: oracleIdOf(index!, best.nameIndex), name: index!.names[best.nameIndex], distance: best.distance, runnerUp: r.runnerUp?.distance ?? 256 };
}

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

function background(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, rand: () => number, busy: boolean) {
  const hue = Math.floor(rand() * 360);
  ctx.fillStyle = `hsl(${hue} ${10 + rand() * 25}% ${15 + rand() * 45}%)`;
  ctx.fillRect(0, 0, w, h);
  // Wood-grain-ish streaks.
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `hsla(${hue} 20% ${rand() * 100}% / ${0.03 + rand() * 0.05})`;
    ctx.lineWidth = 1 + rand() * 6;
    ctx.beginPath();
    const y = rand() * h;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + (rand() - 0.5) * 60, w * 0.6, y + (rand() - 0.5) * 60, w, y + (rand() - 0.5) * 40);
    ctx.stroke();
  }
  if (busy) {
    // Clutter: other rectangles, papers, and straight edges.
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.translate(rand() * w, rand() * h);
      ctx.rotate((rand() - 0.5) * 0.6);
      ctx.fillStyle = `hsl(${rand() * 360} ${rand() * 40}% ${20 + rand() * 60}%)`;
      ctx.fillRect(-60 - rand() * 80, -40 - rand() * 80, 120 + rand() * 160, 80 + rand() * 160);
      ctx.restore();
    }
  }
}

/** Renders one camera frame: the card warped into a perspective quad over a background. */
export function render(url: string, c: Condition, seed: number, jitter: number): Scene {
  const card = images.get(url) ?? null;
  const width = 520, height = 720;
  const guideH = height / 1.24, guideW = guideH * (63 / 88);
  const guide = { x: (width - guideW) / 2, y: (height - guideH) / 2, width: guideW, height: guideH };
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  background(ctx, width, height, rng(seed * 7 + 3), c.busy);
  let truth: Quad | null = null;

  if (card) {
    const jr = rng(seed * 31 + Math.floor(jitter * 1000));
    const j = () => (jr() - 0.5) * 2 * jitter;
    const h = guideH * c.size, w = h * (63 / 88);
    const cx = width / 2 + c.offset[0] * guideW + j() * w, cy = height / 2 + c.offset[1] * guideH + j() * h;
    const angle = ((c.rotate + j() * 40) * Math.PI) / 180;
    const top = 1 - c.tilt / 2, bottom = 1 + c.tilt / 2;
    const local: [number, number][] = [[-w / 2 * top, -h / 2], [w / 2 * top, -h / 2], [w / 2 * bottom, h / 2], [-w / 2 * bottom, h / 2]];
    const corners = local.map(([x, y]) => [cx + x * Math.cos(angle) - y * Math.sin(angle) + j() * w * 0.5, cy + x * Math.sin(angle) + y * Math.cos(angle) + j() * h * 0.5]);
    truth = corners.flat() as unknown as Quad;

    const frame = ctx.getImageData(0, 0, width, height);
    const H = homography(truth);
    const inv = invert3([H[0], H[1], H[2], H[3], H[4], H[5], H[6], H[7], 1]);
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
    const pad = c.sleeve ? 0.035 : 0;
    const radius = 0.045;
    for (let y = Math.max(0, Math.floor(Math.min(...ys) - 20)); y < Math.min(height, Math.ceil(Math.max(...ys) + 20)); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs) - 20)); x < Math.min(width, Math.ceil(Math.max(...xs) + 20)); x++) {
        const px = x + 0.5, py = y + 0.5;
        const wq = inv[6] * px + inv[7] * py + inv[8];
        const u = (inv[0] * px + inv[1] * py + inv[2]) / wq;
        const v = (inv[3] * px + inv[4] * py + inv[5]) / wq;
        if (u < -pad || v < -pad * 0.72 || u > 1 + pad || v > 1 + pad * 0.72) continue;
        const o = (y * width + x) * 4;
        if (u < 0 || v < 0 || u > 1 || v > 1) {
          // Sleeve: a dark, slightly glossy margin around the card.
          frame.data[o] = 18; frame.data[o + 1] = 18; frame.data[o + 2] = 22;
          continue;
        }
        // Rounded corners (in card units, card aspect 63/88).
        const du = Math.min(u, 1 - u), dv = Math.min(v, 1 - v) * (88 / 63);
        if (du < radius && dv < radius && Math.hypot(radius - du, radius - dv) > radius) continue;
        const sx = u * card.width - 0.5, sy = v * card.height - 0.5;
        const x0 = Math.max(0, Math.min(card.width - 2, Math.floor(sx))), y0 = Math.max(0, Math.min(card.height - 2, Math.floor(sy)));
        const ax = Math.max(0, Math.min(1, sx - x0)), ay = Math.max(0, Math.min(1, sy - y0));
        for (let ch = 0; ch < 3; ch++) {
          const i00 = (y0 * card.width + x0) * 4 + ch;
          const top0 = card.data[i00] * (1 - ax) + card.data[i00 + 4] * ax;
          const bot0 = card.data[i00 + card.width * 4] * (1 - ax) + card.data[i00 + card.width * 4 + 4] * ax;
          frame.data[o + ch] = (top0 * (1 - ay) + bot0 * ay) * (1 - c.dim);
        }
      }
    }
    ctx.putImageData(frame, 0, 0);
    if (c.foil) {
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      const g = ctx.createLinearGradient(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
      ["#f0f", "#0ff", "#ff0", "#f80", "#0f8"].forEach((color, k) => g.addColorStop(k / 4, color));
      ctx.globalAlpha = c.foil;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(corners[0][0], corners[0][1]);
      for (const [x, y] of corners.slice(1)) ctx.lineTo(x, y);
      ctx.fill();
      ctx.restore();
    }
    if (c.glare) {
      const gx = cx + (jr() - 0.5) * w * 0.6, gy = cy - h * 0.25 + (jr() - 0.5) * h * 0.3;
      const g = ctx.createRadialGradient(gx, gy, 4, gx, gy, w * 0.45);
      g.addColorStop(0, `rgba(255,255,255,${c.glare})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }
  }

  let out = ctx;
  if (c.blur) {
    const blurred = new OffscreenCanvas(width, height);
    out = blurred.getContext("2d", { willReadFrequently: true })!;
    out.filter = `blur(${c.blur}px)`;
    out.drawImage(canvas, 0, 0);
  }
  const data = out.getImageData(0, 0, width, height);
  if (c.noise) {
    const nr = rng(seed * 13 + Math.floor(jitter * 7919) + 1);
    for (let i = 0; i < data.data.length; i += 4) {
      const n = (nr() + nr() + nr() - 1.5) * c.noise;
      data.data[i] += n; data.data[i + 1] += n; data.data[i + 2] += n;
    }
  }
  return { rgba: data.data, width, height, guide, truth };
}

/** Re-encodes a scene as JPEG (cameras compress) and returns the decoded pixels. */
export async function jpeg(scene: Scene, quality = 0.8): Promise<Scene> {
  const canvas = new OffscreenCanvas(scene.width, scene.height);
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(scene.rgba), scene.width, scene.height), 0, 0);
  const bitmap = await createImageBitmap(await canvas.convertToBlob({ type: "image/jpeg", quality }));
  const ctx = new OffscreenCanvas(scene.width, scene.height).getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  return { ...scene, rgba: ctx.getImageData(0, 0, scene.width, scene.height).data };
}

/** Phase 4 checkpoint: does any detected outline land within 3% of the true corners? */
export function detection(scene: Scene) {
  const outlines = detectOutlines(scene.rgba, scene.width, scene.height);
  if (!scene.truth) return { found: outlines.length, hit: false, error: null as number | null, ms: 0 };
  const t = performance.now();
  detectOutlines(scene.rgba, scene.width, scene.height);
  const ms = performance.now() - t;
  const diag = Math.hypot(scene.width, scene.height);
  let bestError = Infinity;
  for (const o of outlines) {
    let worst = 0;
    for (let i = 0; i < 8; i += 2) worst = Math.max(worst, Math.hypot(o.quad[i] - scene.truth[i], o.quad[i + 1] - scene.truth[i + 1]));
    bestError = Math.min(bestError, worst / diag);
  }
  return { found: outlines.length, hit: bestError <= 0.03, error: Number.isFinite(bestError) ? bestError : null, ms };
}

type Outcome = { kind: string; oracleId: string | null; printingId: string | null; frames: number; ms: number[] };

function outcome(decision: Decision | { kind: string; match?: { oracleId: string; printingId: string } }, frames: number, ms: number[]): Outcome {
  const match = "match" in decision ? decision.match : undefined;
  return { kind: decision.kind, oracleId: match?.oracleId ?? null, printingId: match?.printingId ?? null, frames, ms };
}

/** Live mode: replay jittered frames until a decision (or the frame budget runs out). */
export async function live(url: string | null, c: Condition, seed: number, maxFrames: number, engine: "v1" | "v2"): Promise<Outcome> {
  let state = EMPTY_SCAN;
  let tracker: Tracker = null;
  const ms: number[] = [];
  v1!.reset();
  for (let f = 0; f < maxFrames; f++) {
    const scene = await jpeg(render(url ?? "", c, seed, 0.004 + (f % 7) * 0.001 + f * 1e-6));
    const t = performance.now();
    if (engine === "v2") {
      const r = analyzeFrame(index!, scene.rgba, scene.width, scene.height, { guide: scene.guide, tracker });
      tracker = r.tracker;
      ms.push(performance.now() - t);
      const next = recordFrame(state, r.analysis, f * 66);
      state = next.state;
      if (next.decision.kind !== "wait") return outcome(next.decision, f + 1, ms);
    } else {
      const r = v1!.analyze(scene.rgba, scene.width, scene.height, scene.guide);
      ms.push(performance.now() - t);
      if (r.decision) return outcome(r.decision, f + 1, ms);
    }
  }
  return { kind: "timeout", oracleId: null, printingId: null, frames: maxFrames, ms };
}

/** Photo mode: one frame through the upload path. */
export async function photo(url: string | null, c: Condition, seed: number, engine: "v1" | "v2"): Promise<Outcome> {
  const scene = await jpeg(render(url ?? "", c, seed, 0.004));
  return photoPixels(scene.rgba, scene.width, scene.height, engine);
}

export function photoPixels(rgba: Uint8ClampedArray, width: number, height: number, engine: "v1" | "v2"): Outcome {
  const t = performance.now();
  if (engine === "v2") {
    const { analysis } = analyzeFrame(index!, rgba, width, height, { wholeImage: true });
    return outcome(decidePhoto(analysis), 1, [performance.now() - t]);
  }
  return outcome(v1!.photo(rgba, width, height), 1, [performance.now() - t]);
}

/** Real photo fixtures: decode, reduce like the app does, run photo mode, and replay as live frames. */
export async function realPhoto(url: string, engine: "v1" | "v2", maxFrames: number): Promise<{ photo: Outcome; live: Outcome }> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const fit = (limit: number) => {
    const s = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * s), h = Math.round(bitmap.height * s);
    const ctx = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  };
  const big = fit(1280);
  const photoResult = photoPixels(big.data, big.width, big.height, engine);
  const frame = fit(720 * Math.max(1, bitmap.width / bitmap.height));
  const guideH = Math.min(frame.height / 1.24, (frame.width / 1.24) / (63 / 88));
  const guide = { x: (frame.width - guideH * (63 / 88)) / 2, y: (frame.height - guideH) / 2, width: guideH * (63 / 88), height: guideH };
  let state = EMPTY_SCAN;
  let tracker: Tracker = null;
  const ms: number[] = [];
  v1!.reset();
  const rand = rng(7);
  for (let f = 0; f < maxFrames; f++) {
    const data = new Uint8ClampedArray(frame.data);
    for (let i = 0; i < data.length; i += 4) {
      const n = (rand() - 0.5) * 8;
      data[i] += n; data[i + 1] += n; data[i + 2] += n;
    }
    const t = performance.now();
    if (engine === "v2") {
      const r = analyzeFrame(index!, data, frame.width, frame.height, { guide, tracker });
      tracker = r.tracker;
      ms.push(performance.now() - t);
      const next = recordFrame(state, r.analysis, f * 66);
      state = next.state;
      if (next.decision.kind !== "wait") return { photo: photoResult, live: outcome(next.decision, f + 1, ms) };
    } else {
      const r = v1!.analyze(data, frame.width, frame.height, guide);
      ms.push(performance.now() - t);
      if (r.decision) return { photo: photoResult, live: outcome(r.decision, f + 1, ms) };
    }
  }
  return { photo: photoResult, live: { kind: "timeout", oracleId: null, printingId: null, frames: maxFrames, ms } };
}

export type FramePoint = { correct: boolean; negative: boolean; distance: number; margin: number; hasOutline: boolean; source: string; exact: boolean };

/** Sweep mode: per-frame best distance and margin (with tracking, no decisions), for threshold tuning. */
export async function frames(url: string | null, oracleId: string | null, printingId: string | null, c: Condition, seed: number, count: number): Promise<FramePoint[]> {
  let tracker: Tracker = null;
  const out: FramePoint[] = [];
  for (let f = 0; f < count; f++) {
    const scene = await jpeg(render(url ?? "", c, seed, 0.004 + f * 0.0013));
    const r = analyzeFrame(index!, scene.rgba, scene.width, scene.height, { guide: scene.guide, tracker });
    tracker = r.tracker;
    const a = r.analysis;
    if (!a.best) continue;
    out.push({
      correct: !!oracleId && a.best.oracleId === oracleId,
      negative: !oracleId,
      distance: a.best.distance,
      margin: (a.runnerUp?.distance ?? 256) - a.best.distance,
      hasOutline: a.hasOutline,
      source: a.source,
      exact: a.best.printingId === printingId,
    });
  }
  return out;
}
