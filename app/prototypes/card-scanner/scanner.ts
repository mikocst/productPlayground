// Camera-frame geometry, name-line preprocessing, and OCR candidate extraction.
// Geometry and text helpers are pure; the canvas/OCR helpers run in the browser only.

import type { Worker } from "tesseract.js";
import { CARD_RATIO, FRAME_HEIGHT, NAME_BAND, OCR_WHITELIST } from "./data";
import type { OcrCandidate, Region } from "./types";

type Rect = { x: number; y: number; width: number; height: number };

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

// ---------- Browser-only helpers ----------

const TARGET_BAND_HEIGHT = 96;

/** Crops the name band from a source image into grayscale, contrast-stretched normal and inverted canvases. */
export function prepareNameBand(source: CanvasImageSource, band: Rect): HTMLCanvasElement[] {
  const scale = TARGET_BAND_HEIGHT / Math.max(1, band.height);
  const width = Math.max(1, Math.round(band.width * scale));
  const height = TARGET_BAND_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  context.imageSmoothingQuality = "high";
  context.drawImage(source, band.x, band.y, band.width, band.height, 0, 0, width, height);

  const image = context.getImageData(0, 0, width, height);
  const gray = new Uint8ClampedArray(width * height);
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    const value = Math.round(image.data[p] * 0.299 + image.data[p + 1] * 0.587 + image.data[p + 2] * 0.114);
    gray[i] = value;
    histogram[value]++;
  }
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
