// Camera-frame geometry, frame sampling (motion, sharpness), and multi-placement artwork hashing.
// Geometry and analysis helpers are pure; sampling/hashing helpers run in the browser only.

import { artRect, hashRegion, type ArtHash } from "@/lib/cards/art-hash";
import { CARD_OFFSETS, CARD_RATIO, CARD_SCALES, FRAME_HEIGHT, REFINE_ANGLES, REFINE_OFFSET_STEP, REFINE_SCALE_STEP } from "./data";

export type Rect = { x: number; y: number; width: number; height: number };

// ---------- Geometry ----------

/** Guide frame inside the camera element, in element pixels (matches the CSS overlay). */
export function guideFrame(elementWidth: number, elementHeight: number): Rect {
  let height = elementHeight * FRAME_HEIGHT;
  let width = height * CARD_RATIO;
  if (width > elementWidth * 0.92) {
    width = elementWidth * 0.92;
    height = width / CARD_RATIO;
  }
  return { x: (elementWidth - width) / 2, y: (elementHeight - height) / 2, width, height };
}

/** Maps an element-space rectangle to source pixels for an `object-fit: cover` media element. */
export function coverToSource(rect: Rect, element: { width: number; height: number }, source: { width: number; height: number }): Rect {
  const scale = Math.max(element.width / source.width, element.height / source.height);
  const offsetX = (element.width - source.width * scale) / 2;
  const offsetY = (element.height - source.height * scale) / 2;
  return { x: (rect.x - offsetX) / scale, y: (rect.y - offsetY) / scale, width: rect.width / scale, height: rect.height / scale };
}

/** Largest centered card-ratio rectangle inside an uploaded photo. */
export function containedCard(source: { width: number; height: number }): Rect {
  const width = Math.min(source.width, source.height * CARD_RATIO);
  const height = width / CARD_RATIO;
  return { x: (source.width - width) / 2, y: (source.height - height) / 2, width, height };
}

/** A candidate card position relative to the guide frame: center offset and size as fractions of it, tilt in degrees. */
export type Placement = { dx: number; dy: number; scale: number; angle: number };

export function placementRect(frame: Rect, p: Placement): Rect {
  const width = frame.width * p.scale;
  const height = frame.height * p.scale;
  return {
    x: frame.x + frame.width / 2 - width / 2 + p.dx * frame.width,
    y: frame.y + frame.height / 2 - height / 2 + p.dy * frame.height,
    width,
    height,
  };
}

/** Coarse grid: every size in CARD_SCALES at every offset in CARD_OFFSETS, untilted. */
export function coarsePlacements(): Placement[] {
  const out: Placement[] = [];
  for (const scale of CARD_SCALES) for (const dy of CARD_OFFSETS) for (const dx of CARD_OFFSETS) out.push({ dx, dy, scale, angle: 0 });
  return out;
}

/** Finer grid around the best coarse placement, plus slight tilts of it. */
export function refinePlacements(p: Placement): Placement[] {
  const out: Placement[] = [];
  for (const ds of [-REFINE_SCALE_STEP, 0, REFINE_SCALE_STEP]) {
    for (const oy of [-REFINE_OFFSET_STEP, 0, REFINE_OFFSET_STEP]) {
      for (const ox of [-REFINE_OFFSET_STEP, 0, REFINE_OFFSET_STEP]) {
        if (ds || oy || ox) out.push({ dx: p.dx + ox, dy: p.dy + oy, scale: p.scale * (1 + ds), angle: p.angle });
      }
    }
  }
  for (const angle of REFINE_ANGLES) out.push({ ...p, angle: p.angle + angle });
  return out;
}

// ---------- Frame analysis (pure) ----------

/** Mean absolute difference between two equally sized grayscale samples (0–255). */
export function meanAbsDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length || a.length === 0) return 255;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

/**
 * Contrast-normalized gradient energy (higher is sharper, roughly independent of lighting) and the
 * standard deviation (texture). Flat scenes such as an empty table have low texture.
 */
export function frameQuality(gray: Uint8ClampedArray, width: number, height: number): { sharpness: number; texture: number } {
  if (width < 2 || height < 2) return { sharpness: 0, texture: 0 };
  let gradient = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const v = gray[y * width + x];
      gradient += Math.abs(gray[y * width + x + 1] - v) + Math.abs(gray[(y + 1) * width + x] - v);
      sum += v;
      sumSq += v * v;
    }
  }
  const n = (width - 1) * (height - 1);
  const std = Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2));
  return { sharpness: gradient / n / (std + 8), texture: std };
}

// ---------- Browser-only helpers ----------

/** Draws `rect` of `source` at width×height and returns grayscale pixels. */
export function sampleGray(context: CanvasRenderingContext2D, source: CanvasImageSource, rect: Rect, width: number, height: number): Uint8ClampedArray {
  const canvas = context.canvas;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  return gray;
}

/** Art-window fingerprints of `placements` around the guide `frame`. */
export function hashPlacements(context: CanvasRenderingContext2D, source: CanvasImageSource, frame: Rect, placements: Placement[]): ArtHash[] {
  return placements.map((p) => hashRegion(context, source, artRect(placementRect(frame, p)), (p.angle * Math.PI) / 180));
}
