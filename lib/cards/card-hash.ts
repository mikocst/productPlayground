// Whole-card perceptual hash: perspective-correct a card from four corners, sample 64×64 luma, keep the
// low 16×16 DCT coefficients, and set one bit per coefficient above their median (256 bits).
//
// Pure and dependency-free: the index builder (in headless Chromium), the scanner worker, and the eval
// harness all import this file, so a card hashes identically everywhere. No DOM, no canvas.

/** Corners in pixels, clockwise from top-left: [TLx, TLy, TRx, TRy, BRx, BRy, BLx, BLy]. */
export type Quad = readonly [number, number, number, number, number, number, number, number];

/** Single-channel image. */
export type Plane = { data: Float32Array; width: number; height: number };

export const HASH_SIZE = 64;
export const HASH_KEEP = 16;
export const HASH_WORDS = 8;
export const HASH_BITS = 256;

/**
 * Sampled part of the card. Drops the rounded corners, sleeve edges and any background a slightly
 * loose outline lets in, while keeping the frame, title bar and text box.
 */
export const CARD_INSET = { x: 0.05, y: 0.04 };

/** Card height (in plane pixels) the sampling is tuned for: Scryfall's `small` image is 204 px tall. */
export const REFERENCE_HEIGHT = 204;

/** The whole image as a quad: a card scan or a straightened photo *is* the card. */
export function imageQuad(width: number, height: number): Quad {
  return [0, 0, width, 0, width, height, 0, height];
}

/** Luma (BT.601) of an RGBA buffer, box-averaged by an integer factor. */
export function lumaPlane(rgba: ArrayLike<number>, width: number, height: number, factor = 1): Plane {
  const f = Math.max(1, Math.floor(factor));
  const w = Math.max(1, Math.floor(width / f));
  const h = Math.max(1, Math.floor(height / f));
  const data = new Float32Array(w * h);
  if (f === 1) {
    for (let i = 0, o = 0; o < data.length; o++, i += 4) data[o] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    return { data, width: w, height: h };
  }
  const norm = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < f; dy++) {
        let i = ((y * f + dy) * width + x * f) * 4;
        for (let dx = 0; dx < f; dx++, i += 4) sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      }
      data[y * w + x] = sum * norm;
    }
  }
  return { data, width: w, height: h };
}

/** Box-downscale a plane by an integer factor. */
export function shrinkPlane(plane: Plane, factor: number): Plane {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return plane;
  const w = Math.max(1, Math.floor(plane.width / f));
  const h = Math.max(1, Math.floor(plane.height / f));
  const data = new Float32Array(w * h);
  const norm = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * plane.width + x * f;
        for (let dx = 0; dx < f; dx++) sum += plane.data[row + dx];
      }
      data[y * w + x] = sum * norm;
    }
  }
  return { data, width: w, height: h };
}

/** Mean of the left/right side lengths of a quad: the card's height in pixels. */
export function quadHeight(q: Quad): number {
  return (Math.hypot(q[6] - q[0], q[7] - q[1]) + Math.hypot(q[4] - q[2], q[5] - q[3])) / 2;
}

/**
 * Integer shrink factor that brings a card of this height close to REFERENCE_HEIGHT, so the 64×64
 * sampling sees the same detail (and the same aliasing) in a camera frame as in the index images.
 */
export function shrinkFactor(cardHeight: number): number {
  return Math.max(1, Math.round(cardHeight / REFERENCE_HEIGHT));
}

/**
 * Projective map from the unit square to the quad: (0,0)→TL, (1,0)→TR, (1,1)→BR, (0,1)→BL.
 * Returns [a, b, c, d, e, f, g, h] with x = (a·u + b·v + c) / (g·u + h·v + 1), y = (d·u + e·v + f) / (…).
 */
export function homography(q: Quad): Float64Array {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let g = 0;
  let h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) > 1e-12) {
      g = (sx * dy2 - dx2 * sy) / det;
      h = (dx1 * sy - sx * dy1) / det;
    }
  }
  return Float64Array.of(x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h);
}

/** Applies a homography to unit-square coordinates. */
export function project(H: Float64Array, u: number, v: number): [number, number] {
  const w = H[6] * u + H[7] * v + 1;
  return [(H[0] * u + H[1] * v + H[2]) / w, (H[3] * u + H[4] * v + H[5]) / w];
}

function bilinear(p: Plane, x: number, y: number): number {
  const { data, width, height } = p;
  let fx = x - 0.5;
  let fy = y - 0.5;
  if (fx < 0) fx = 0;
  else if (fx > width - 1) fx = width - 1;
  if (fy < 0) fy = 0;
  else if (fy > height - 1) fy = height - 1;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1 < width ? x0 + 1 : x0;
  const y1 = y0 + 1 < height ? y0 + 1 : y0;
  const ax = fx - x0;
  const ay = fy - y0;
  const top = data[y0 * width + x0] * (1 - ax) + data[y0 * width + x1] * ax;
  const bottom = data[y1 * width + x0] * (1 - ax) + data[y1 * width + x1] * ax;
  return top * (1 - ay) + bottom * ay;
}

/**
 * Perspective-corrected size×size luma sample of the quad's inset area. Quad coordinates are in pixels
 * of the full-resolution image; `scale` maps them onto the plane (1 / shrink factor). Each output pixel
 * averages 2×2 bilinear samples, which is cheap anti-aliasing.
 */
export function warpGray(plane: Plane, H: Float64Array, scale = 1, inset = CARD_INSET, size = HASH_SIZE): Float32Array {
  const out = new Float32Array(size * size);
  const u0 = inset.x;
  const v0 = inset.y;
  const du = (1 - 2 * inset.x) / size;
  const dv = (1 - 2 * inset.y) / size;
  const [a, b, c, d, e, f, g, h] = H;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let sj = 0.25; sj < 1; sj += 0.5) {
        const v = v0 + (j + sj) * dv;
        for (let si = 0.25; si < 1; si += 0.5) {
          const u = u0 + (i + si) * du;
          const w = g * u + h * v + 1;
          sum += bilinear(plane, ((a * u + b * v + c) / w) * scale, ((d * u + e * v + f) / w) * scale);
        }
      }
      out[j * size + i] = sum * 0.25;
    }
  }
  return out;
}

const cosTables = new Map<string, Float32Array>();
function cosines(n: number, keep: number): Float32Array {
  const key = `${n}:${keep}`;
  let table = cosTables.get(key);
  if (!table) {
    table = new Float32Array(keep * n);
    for (let k = 0; k < keep; k++) for (let x = 0; x < n; x++) table[k * n + x] = Math.cos(((2 * x + 1) * k * Math.PI) / (2 * n));
    cosTables.set(key, table);
  }
  return table;
}

/** Separable 2D DCT-II of an n×n block, returning only the top-left keep×keep coefficients (row-major). */
export function dct2(block: Float32Array, n = HASH_SIZE, keep = HASH_KEEP): Float32Array {
  const c = cosines(n, keep);
  const rows = new Float32Array(n * keep);
  for (let y = 0; y < n; y++) {
    for (let k = 0; k < keep; k++) {
      let sum = 0;
      for (let x = 0; x < n; x++) sum += block[y * n + x] * c[k * n + x];
      rows[y * keep + k] = sum;
    }
  }
  const out = new Float32Array(keep * keep);
  for (let ky = 0; ky < keep; ky++) {
    for (let kx = 0; kx < keep; kx++) {
      let sum = 0;
      for (let y = 0; y < n; y++) sum += rows[y * keep + kx] * c[ky * n + y];
      out[ky * keep + kx] = sum;
    }
  }
  return out;
}

/** One bit per coefficient: set where it exceeds the median of the 255 non-DC coefficients. */
export function hash256(coeffs: Float32Array): Uint32Array {
  const sorted = coeffs.slice(1).sort();
  const median = sorted[(sorted.length - 1) >> 1];
  const out = new Uint32Array(HASH_WORDS);
  for (let i = 0; i < HASH_BITS; i++) if (coeffs[i] > median) out[i >> 5] |= 1 << (i & 31);
  return out;
}

export function popcount(v: number): number {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Hamming distance between the 256-bit hash at a[aOff…] and b. */
export function hamming256(a: Uint32Array, aOff: number, b: Uint32Array): number {
  return (
    popcount(a[aOff] ^ b[0]) + popcount(a[aOff + 1] ^ b[1]) + popcount(a[aOff + 2] ^ b[2]) + popcount(a[aOff + 3] ^ b[3]) +
    popcount(a[aOff + 4] ^ b[4]) + popcount(a[aOff + 5] ^ b[5]) + popcount(a[aOff + 6] ^ b[6]) + popcount(a[aOff + 7] ^ b[7])
  );
}

/**
 * Luma planes of one frame, each built straight from the RGBA at the shrink factor a quad needs (once per
 * factor), so candidate quads share them without recomputing.
 */
export class FramePlanes {
  private readonly planes = new Map<number, Plane>();
  constructor(private readonly rgba: ArrayLike<number>, private readonly width: number, private readonly height: number) {}
  get(factor: number): Plane {
    let plane = this.planes.get(factor);
    if (!plane) {
      plane = lumaPlane(this.rgba, this.width, this.height, factor);
      this.planes.set(factor, plane);
    }
    return plane;
  }
  /** Any plane already built (the coarsest is cheapest to scan), with its factor. */
  any(): { plane: Plane; factor: number } {
    let best = 0;
    for (const factor of this.planes.keys()) best = Math.max(best, factor);
    const factor = best || 2;
    return { plane: this.get(factor), factor };
  }
}

/** Hashes the card inside `quad` (full-resolution pixel coordinates). */
export function hashQuad(planes: FramePlanes, quad: Quad): Uint32Array {
  const factor = shrinkFactor(quadHeight(quad));
  return hash256(dct2(warpGray(planes.get(factor), homography(quad), 1 / factor)));
}

/** Hashes a whole image that is just the card (index images and straightened uploads). */
export function hashCardPixels(rgba: ArrayLike<number>, width: number, height: number): Uint32Array {
  return hashQuad(new FramePlanes(rgba, width, height), imageQuad(width, height));
}
