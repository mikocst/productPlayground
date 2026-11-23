// Perceptual hashing of card artwork. Shared verbatim by the browser scanner and the index builder
// (scripts/build-card-art-index.ts bundles this file into a headless browser), so both sides hash identically.
// No imports: this module must stay self-contained.

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Art window as a fraction of the whole card. It sits inside the illustration on modern and classic frames;
 * on other frames it is simply a consistent window, which is all matching needs.
 */
export const ART_WINDOW = { x: 0.1, y: 0.14, width: 0.8, height: 0.38 };

const INTERMEDIATE = 128;
const SIZE = 32;
const LOW = 8;

export function artRect(card: Rect): Rect {
  return {
    x: card.x + card.width * ART_WINDOW.x,
    y: card.y + card.height * ART_WINDOW.y,
    width: card.width * ART_WINDOW.width,
    height: card.height * ART_WINDOW.height,
  };
}

/** Exact box-average downsample of a grayscale image. */
export function boxDownsample(gray: ArrayLike<number>, width: number, height: number, outWidth: number, outHeight: number): Float32Array {
  const out = new Float32Array(outWidth * outHeight);
  const sx = width / outWidth;
  const sy = height / outHeight;
  for (let oy = 0; oy < outHeight; oy++) {
    const y0 = Math.floor(oy * sy);
    const y1 = Math.max(y0 + 1, Math.floor((oy + 1) * sy));
    for (let ox = 0; ox < outWidth; ox++) {
      const x0 = Math.floor(ox * sx);
      const x1 = Math.max(x0 + 1, Math.floor((ox + 1) * sx));
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += gray[y * width + x];
      out[oy * outWidth + ox] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

let cosTable: Float32Array | null = null;
function cosines(): Float32Array {
  if (!cosTable) {
    cosTable = new Float32Array(LOW * SIZE);
    for (let u = 0; u < LOW; u++) for (let x = 0; x < SIZE; x++) cosTable[u * SIZE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE));
  }
  return cosTable;
}

/**
 * 64-bit pHash of a 32×32 grayscale block: the low 8×8 DCT coefficients (DC excluded from the median),
 * each bit set when the coefficient exceeds the median. Returned as two unsigned 32-bit halves.
 */
export function phash(block: Float32Array): [number, number] {
  const c = cosines();
  const rows = new Float32Array(SIZE * LOW);
  for (let y = 0; y < SIZE; y++) {
    for (let u = 0; u < LOW; u++) {
      let sum = 0;
      for (let x = 0; x < SIZE; x++) sum += block[y * SIZE + x] * c[u * SIZE + x];
      rows[y * LOW + u] = sum;
    }
  }
  const coeffs = new Float32Array(LOW * LOW);
  for (let v = 0; v < LOW; v++) {
    for (let u = 0; u < LOW; u++) {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) sum += rows[y * LOW + u] * c[v * SIZE + y];
      coeffs[v * LOW + u] = sum;
    }
  }
  const sorted = Array.from(coeffs.subarray(1)).sort((a, b) => a - b);
  const median = (sorted[31] + sorted[32]) / 2;
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < 64; i++) {
    if (coeffs[i] > median) {
      if (i < 32) hi |= 1 << i;
      else lo |= 1 << (i - 32);
    }
  }
  return [hi >>> 0, lo >>> 0];
}

export function popcount(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Grayscale pixels from RGBA. */
export function toGray(rgba: Uint8ClampedArray): Float32Array {
  const gray = new Float32Array(rgba.length / 4);
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114;
  return gray;
}

/** Red-minus-blue opponent channel: separates warm from cool regions, independent of brightness. */
export function toChroma(rgba: Uint8ClampedArray): Float32Array {
  const chroma = new Float32Array(rgba.length / 4);
  for (let i = 0; i < chroma.length; i++) chroma[i] = rgba[i * 4] - rgba[i * 4 + 2];
  return chroma;
}

/** 128-bit fingerprint: [luma hi, luma lo, chroma hi, chroma lo]. */
export type ArtHash = [number, number, number, number];
export const HASH_WORDS = 4;
export const HASH_BITS = 128;

/**
 * Browser: fingerprints `rect` of `source` (drawn to 128×128, box-averaged to 32×32). `context` is reusable.
 * `angle` (radians) de-rotates the region about its center, for cards held at a slight tilt.
 */
export function hashRegion(context: CanvasRenderingContext2D, source: CanvasImageSource, rect: Rect, angle = 0): ArtHash {
  const canvas = context.canvas;
  if (canvas.width !== INTERMEDIATE || canvas.height !== INTERMEDIATE) {
    canvas.width = INTERMEDIATE;
    canvas.height = INTERMEDIATE;
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (angle) {
    context.save();
    context.translate(INTERMEDIATE / 2, INTERMEDIATE / 2);
    context.scale(INTERMEDIATE / rect.width, INTERMEDIATE / rect.height);
    context.rotate(-angle);
    context.translate(-(rect.x + rect.width / 2), -(rect.y + rect.height / 2));
    context.drawImage(source, 0, 0);
    context.restore();
  } else {
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, INTERMEDIATE, INTERMEDIATE);
  }
  const rgba = context.getImageData(0, 0, INTERMEDIATE, INTERMEDIATE).data;
  const luma = phash(boxDownsample(toGray(rgba), INTERMEDIATE, INTERMEDIATE, SIZE, SIZE));
  const chroma = phash(boxDownsample(toChroma(rgba), INTERMEDIATE, INTERMEDIATE, SIZE, SIZE));
  return [luma[0], luma[1], chroma[0], chroma[1]];
}

/** Hamming distance between two fingerprints (0–128). */
export function distance(a: ArrayLike<number>, aOffset: number, b: ArrayLike<number>): number {
  let d = 0;
  for (let w = 0; w < HASH_WORDS; w++) d += popcount((a[aOffset + w] ^ b[w]) >>> 0);
  return d;
}

/** Browser: fingerprint of a whole card image's art window. */
export function hashCardImage(context: CanvasRenderingContext2D, image: { width: number; height: number } & CanvasImageSource): ArtHash {
  return hashRegion(context, image, artRect({ x: 0, y: 0, width: image.width, height: image.height }));
}
