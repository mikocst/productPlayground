// Camera-frame geometry, name-line preprocessing, and OCR candidate extraction.
// Geometry and text helpers are pure; the canvas/OCR helpers run in the browser only.

import type { Worker } from "tesseract.js";
import { CARD_RATIO, FRAME_HEIGHT, NAME_BAND, OCR_WHITELIST } from "./data";
import type { OcrCandidate, Region } from "./types";

export type Rect = { x: number; y: number; width: number; height: number };

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
  return {
    x: (rect.x - offsetX) / scale,
    y: (rect.y - offsetY) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/** Largest centered card-ratio rectangle inside an uploaded photo. */
export function containedCard(source: { width: number; height: number }): Rect {
  const width = Math.min(source.width, source.height * CARD_RATIO);
  const height = width / CARD_RATIO;
  return { x: (source.width - width) / 2, y: (source.height - height) / 2, width, height };
}

export function subRegion(card: Rect, band: Region = NAME_BAND): Rect {
  return {
    x: card.x + card.width * band.x,
    y: card.y + card.height * band.y,
    width: card.width * band.width,
    height: card.height * band.height,
  };
}

const NOISE_TOKEN = /^[^aeiouy]{1,2}$/i;

/** Cleans one OCR line into a plausible card name, or null. */
export function cleanLine(line: string): string | null {
  const tokens = line
    .replace(/[^A-Za-z ',\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  // Mana symbols and frame edges read as short consonant clusters at either end.
  while (tokens.length > 1 && NOISE_TOKEN.test(tokens[tokens.length - 1])) tokens.pop();
  while (tokens.length > 1 && NOISE_TOKEN.test(tokens[0])) tokens.shift();
  const text = tokens.join(" ").replace(/^[',\-]+|[',\-]+$/g, "");
  return text.length >= 3 && /[aeiouy]/i.test(text) ? text : null;
}

/** Up to three distinct name candidates, most confident first. */
export function extractCandidates(results: OcrCandidate[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const result of [...results].sort((a, b) => b.confidence - a.confidence)) {
    for (const line of result.text.split("\n")) {
      const clean = cleanLine(line);
      if (!clean || seen.has(clean.toLowerCase())) continue;
      seen.add(clean.toLowerCase());
      out.push(clean);
    }
  }
  return out.slice(0, 3);
}

/** Mean absolute difference between two equally sized grayscale samples (0–255). */
export function meanAbsDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length || a.length === 0) return 255;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

/** Fraction of horizontally adjacent pixel pairs with a strong step — high where text is printed. */
export function edgeDensity(gray: Uint8ClampedArray, width: number, height: number, step = 28): number {
  if (width < 2 || height < 1) return 0;
  let edges = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 1; x < width; x++) if (Math.abs(gray[row + x] - gray[row + x - 1]) > step) edges++;
  }
  return edges / ((width - 1) * height);
}

// ---------- Browser-only helpers ----------

/** Draws `rect` of `source` into a small canvas and returns its grayscale pixels. */
export function sampleGray(context: CanvasRenderingContext2D, source: CanvasImageSource, rect: Rect, width: number, height: number): Uint8ClampedArray {
  const canvas = context.canvas;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  }
  return gray;
}

/**
 * Finds the printed name inside a generous band: the run of rows with the most horizontal-edge mass.
 * Returns padded row bounds, or the whole band when nothing stands out.
 */
export function locateTextLine(gray: Uint8ClampedArray, width: number, height: number): { start: number; end: number } {
  const whole = { start: 0, end: height };
  if (width < 2 || height < 4) return whole;
  const raw = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) {
    let edges = 0;
    const row = y * width;
    for (let x = 1; x < width; x++) if (Math.abs(gray[row + x] - gray[row + x - 1]) > 28) edges++;
    raw[y] = edges / (width - 1);
  }
  const profile = raw.map((_, y) => (raw[Math.max(0, y - 1)] + raw[y] + raw[Math.min(height - 1, y + 1)]) / 3);
  const peak = Math.max(...profile);
  if (peak < 0.03) return whole;

  const threshold = peak * 0.35;
  let best = { start: 0, end: 0, mass: 0 };
  let start = -1;
  let mass = 0;
  for (let y = 0; y <= height; y++) {
    if (y < height && profile[y] >= threshold) {
      if (start < 0) start = y;
      mass += profile[y];
    } else if (start >= 0) {
      if (mass > best.mass) best = { start, end: y, mass };
      start = -1;
      mass = 0;
    }
  }
  const pad = Math.max(4, Math.round((best.end - best.start) * 0.3));
  return { start: Math.max(0, best.start - pad), end: Math.min(height, best.end + pad) };
}

const BAND_DRAW_HEIGHT = 160;

/**
 * Crops the name band, isolates the text line inside it, and returns grayscale, contrast-stretched
 * normal and inverted canvases (inverted helps light-on-dark title bars).
 */
export function prepareNameBand(source: CanvasImageSource, band: Rect): HTMLCanvasElement[] {
  const scale = BAND_DRAW_HEIGHT / Math.max(1, band.height);
  const width = Math.max(1, Math.round(band.width * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = BAND_DRAW_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  context.imageSmoothingQuality = "high";
  context.drawImage(source, band.x, band.y, band.width, band.height, 0, 0, width, BAND_DRAW_HEIGHT);

  const image = context.getImageData(0, 0, width, BAND_DRAW_HEIGHT);
  const full = new Uint8ClampedArray(width * BAND_DRAW_HEIGHT);
  for (let i = 0; i < full.length; i++) {
    const p = i * 4;
    full[i] = image.data[p] * 0.299 + image.data[p + 1] * 0.587 + image.data[p + 2] * 0.114;
  }
  const line = locateTextLine(full, width, BAND_DRAW_HEIGHT);
  const height = Math.max(1, line.end - line.start);
  const gray = full.subarray(line.start * width, line.end * width);
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) histogram[gray[i]]++;
  const percentile = (fraction: number) => {
    let count = 0;
    for (let v = 0; v < 256; v++) {
      count += histogram[v];
      if (count >= gray.length * fraction) return v;
    }
    return 255;
  };
  const low = percentile(0.05);
  const high = Math.max(low + 1, percentile(0.95));

  const variants = [false, true].map((invert) => {
    const out = context.createImageData(width, height);
    for (let i = 0; i < gray.length; i++) {
      let value = ((gray[i] - low) / (high - low)) * 255;
      if (invert) value = 255 - value;
      const p = i * 4;
      out.data[p] = out.data[p + 1] = out.data[p + 2] = value;
      out.data[p + 3] = 255;
    }
    const variant = document.createElement("canvas");
    variant.width = width;
    variant.height = height;
    variant.getContext("2d")?.putImageData(out, 0, 0);
    return variant;
  });
  return variants;
}

/** Lazily loads Tesseract.js (worker, core, and English data are fetched once and cached by the browser). */
export async function createOcrWorker(): Promise<Worker> {
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY);
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    tessedit_char_whitelist: OCR_WHITELIST,
    preserve_interword_spaces: "1",
  });
  return worker;
}

export async function readNameBand(worker: Worker, canvases: HTMLCanvasElement[]): Promise<{ candidates: string[]; raw: string }> {
  const results: OcrCandidate[] = [];
  for (const canvas of canvases) {
    const { data } = await worker.recognize(canvas);
    results.push({ text: data.text, confidence: data.confidence });
  }
  const best = [...results].sort((a, b) => b.confidence - a.confidence)[0];
  return { candidates: extractCandidates(results), raw: best?.text.trim() ?? "" };
}
