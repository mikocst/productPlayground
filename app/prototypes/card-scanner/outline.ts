// Card outline detection on an RGBA frame. Pure (no DOM), runs in the scan worker and the eval harness.
//
//   downscale (box, longest side DETECT_SIZE) → [1 2 1] blur → Sobel per RGB channel, keeping the strongest
//   → angle-limited Hough (near-vertical and near-horizontal lines only, each pixel voting near its own
//   gradient direction) → pair two vertical with two horizontal lines → geometric filters → edge support
//   → best quads by score and by shape, in frame pixels.

import type { Quad } from "@/lib/cards/card-hash";
import {
  CORNER_SLACK,
  DETECT_SIZE,
  EXTREME_LINES,
  GRADIENT_WINDOW,
  LINE_BAND,
  MAX_ASPECT,
  MAX_LINES,
  MAX_SIDE_DIFF,
  MIN_AREA,
  MIN_ASPECT,
  MIN_SIDE_SUPPORT,
  OUTLINES_BY_SCORE,
  OUTLINES_BY_SHAPE,
  STRONG_LINES,
  SUPPORT_FLOOR,
  SUPPORT_PERCENTILE,
  VOTE_FLOOR,
  VOTE_PERCENTILE,
} from "./data";

export type Outline = { quad: Quad; score: number; shape: number; support: number; aspect: number };

/** Physical card aspect, width / height. */
const CARD_ASPECT = 63 / 88;
const DEG = Math.PI / 180;

type Line = { family: 0 | 1; theta: number; rho: number; votes: number; position: number };

/** Box-averaged RGB planes at `scale`. */
function downscale(rgba: ArrayLike<number>, width: number, height: number, w: number, h: number): Float32Array[] {
  const planes = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  const sx = width / w;
  const sy = height / h;
  const xStart = new Int32Array(w);
  const xEnd = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    xStart[x] = Math.floor(x * sx);
    xEnd[x] = Math.max(xStart[x] + 1, Math.min(width, Math.floor((x + 1) * sx)));
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = xStart[x];
      const x1 = xEnd[x];
      let r = 0, g = 0, b = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0, i = (yy * width + x0) * 4; xx < x1; xx++, i += 4) {
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = y * w + x;
      planes[0][o] = r / n;
      planes[1][o] = g / n;
      planes[2][o] = b / n;
    }
  }
  return planes;
}

/** Separable [1, 2, 1] / 4 blur with clamped borders, in place. */
function blur(plane: Float32Array, w: number, h: number) {
  const tmp = new Float32Array(plane.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const l = plane[row + (x > 0 ? x - 1 : x)];
      const r = plane[row + (x < w - 1 ? x + 1 : x)];
      tmp[row + x] = (l + 2 * plane[row + x] + r) * 0.25;
    }
  }
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w;
    const down = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) plane[y * w + x] = (tmp[up + x] + 2 * tmp[y * w + x] + tmp[down + x]) * 0.25;
  }
}

/** Sobel on every channel; per pixel, the channel with the strongest gradient wins (its gx, gy are kept). */
function gradients(planes: Float32Array[], w: number, h: number) {
  const magnitude = new Float32Array(w * h);
  const gxs = new Float32Array(w * h);
  const gys = new Float32Array(w * h);
  const [pr, pg, pb] = planes;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1, o = y * w + 1; x < w - 1; x++, o++) {
      const a = o - w, c = o + w;
      let gx = pr[a + 1] + 2 * pr[o + 1] + pr[c + 1] - pr[a - 1] - 2 * pr[o - 1] - pr[c - 1];
      let gy = pr[c - 1] + 2 * pr[c] + pr[c + 1] - pr[a - 1] - 2 * pr[a] - pr[a + 1];
      let best = gx * gx + gy * gy;
      const gx2 = pg[a + 1] + 2 * pg[o + 1] + pg[c + 1] - pg[a - 1] - 2 * pg[o - 1] - pg[c - 1];
      const gy2 = pg[c - 1] + 2 * pg[c] + pg[c + 1] - pg[a - 1] - 2 * pg[a] - pg[a + 1];
      const m2 = gx2 * gx2 + gy2 * gy2;
      if (m2 > best) { best = m2; gx = gx2; gy = gy2; }
      const gx3 = pb[a + 1] + 2 * pb[o + 1] + pb[c + 1] - pb[a - 1] - 2 * pb[o - 1] - pb[c - 1];
      const gy3 = pb[c - 1] + 2 * pb[c] + pb[c + 1] - pb[a - 1] - 2 * pb[a] - pb[a + 1];
      const m3 = gx3 * gx3 + gy3 * gy3;
      if (m3 > best) { best = m3; gx = gx3; gy = gy3; }
      magnitude[o] = Math.sqrt(best);
      gxs[o] = gx;
      gys[o] = gy;
    }
  }
  return { magnitude, gxs, gys };
}

function percentile(values: Float32Array, p: number): number {
  let max = 0;
  for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
  if (max === 0) return 0;
  const bins = 512;
  const histogram = new Uint32Array(bins);
  for (let i = 0; i < values.length; i++) histogram[Math.min(bins - 1, Math.floor((values[i] / max) * bins))]++;
  const target = values.length * p;
  let count = 0;
  for (let b = 0; b < bins; b++) {
    count += histogram[b];
    if (count >= target) return ((b + 1) / bins) * max;
  }
  return max;
}

/**
 * Hough transform limited to two families: lines whose normal is within LINE_BAND° of horizontal (vertical
 * lines, family 0) or of vertical (horizontal lines, family 1). Coordinates are centered on the image.
 */
function houghLines(magnitude: Float32Array, gxs: Float32Array, gys: Float32Array, w: number, h: number, threshold: number): Line[] {
  const thetas = 2 * LINE_BAND + 1;
  const rhoMax = Math.ceil(Math.hypot(w, h) / 2);
  const rhos = 2 * rhoMax + 1;
  const acc = [new Uint16Array(thetas * rhos), new Uint16Array(thetas * rhos)];
  // Family 0: theta −B…B (normal near the x axis). Family 1: theta 90−B…90+B.
  const cos = [new Float32Array(thetas), new Float32Array(thetas)];
  const sin = [new Float32Array(thetas), new Float32Array(thetas)];
  for (let t = 0; t < thetas; t++) {
    const a0 = (t - LINE_BAND) * DEG;
    const a1 = (90 + t - LINE_BAND) * DEG;
    cos[0][t] = Math.cos(a0);
    sin[0][t] = Math.sin(a0);
    cos[1][t] = Math.cos(a1);
    sin[1][t] = Math.sin(a1);
  }
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const o = y * w + x;
      if (magnitude[o] < threshold) continue;
      // Normal direction folded to −90…90 (a line's normal sign doesn't matter).
      let phi = Math.atan2(gys[o], gxs[o]) / DEG; // the edge normal, −180…180
      if (phi > 90) phi -= 180;
      else if (phi < -90) phi += 180;
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      let family: 0 | 1;
      let center: number;
      if (Math.abs(phi) <= LINE_BAND + GRADIENT_WINDOW) {
        family = 0;
        center = phi + LINE_BAND;
      } else if (Math.abs(Math.abs(phi) - 90) <= LINE_BAND + GRADIENT_WINDOW) {
        family = 1;
        // Normal near ±90°: express as 90 + offset, offset in −B…B.
        center = (phi < 0 ? phi + 180 : phi) - 90 + LINE_BAND;
      } else continue;
      const t0 = Math.max(0, Math.ceil(center - GRADIENT_WINDOW));
      const t1 = Math.min(thetas - 1, Math.floor(center + GRADIENT_WINDOW));
      const a = acc[family], c = cos[family], s = sin[family];
      for (let t = t0; t <= t1; t++) {
        a[t * rhos + ((px * c[t] + py * s[t] + rhoMax + 0.5) | 0)]++;
      }
    }
  }

  const peaks: Line[] = [];
  const minVotes = Math.max(12, Math.min(w, h) * 0.12);
  for (const family of [0, 1] as const) {
    const a = acc[family];
    for (let t = 0; t < thetas; t++) {
      for (let r = 0; r < rhos; r++) {
        const v = a[t * rhos + r];
        if (v < minVotes) continue;
        let isMax = true;
        for (let dt = -3; dt <= 3 && isMax; dt++) {
          const tt = t + dt;
          if (tt < 0 || tt >= thetas) continue;
          for (let dr = -4; dr <= 4; dr++) {
            const rr = r + dr;
            if (rr < 0 || rr >= rhos || (dt === 0 && dr === 0)) continue;
            const u = a[tt * rhos + rr];
            // Ties: keep the first in scan order.
            if (u > v || (u === v && (dt < 0 || (dt === 0 && dr < 0)))) {
              isMax = false;
              break;
            }
          }
        }
        if (!isMax) continue;
        const theta = (family === 0 ? t - LINE_BAND : 90 + t - LINE_BAND) * DEG;
        const rho = r - rhoMax;
        // Where the line crosses the center row (vertical lines) or center column (horizontal lines).
        const position = family === 0 ? rho / Math.cos(theta) : rho / Math.sin(theta);
        peaks.push({ family, theta, rho, votes: v, position });
      }
    }
  }
  return peaks.sort((x, y) => y.votes - x.votes).slice(0, MAX_LINES);
}

/** Strongest lines plus the outermost reasonably strong ones on each side. */
function pickLines(lines: Line[], family: 0 | 1): Line[] {
  const own = lines.filter((l) => l.family === family);
  if (!own.length) return [];
  const picked = new Set(lines.slice(0, STRONG_LINES).filter((l) => l.family === family));
  const strong = own.filter((l) => l.votes >= own[0].votes * 0.3).sort((a, b) => a.position - b.position);
  for (const l of strong.slice(0, EXTREME_LINES)) picked.add(l);
  for (const l of strong.slice(-EXTREME_LINES)) picked.add(l);
  return [...picked].sort((a, b) => a.position - b.position);
}

function intersect(a: Line, b: Line): [number, number] | null {
  const c1 = Math.cos(a.theta), s1 = Math.sin(a.theta);
  const c2 = Math.cos(b.theta), s2 = Math.sin(b.theta);
  const det = c1 * s2 - s1 * c2;
  if (Math.abs(det) < 1e-6) return null;
  return [(a.rho * s2 - s1 * b.rho) / det, (c1 * b.rho - a.rho * c2) / det];
}

/** Fraction of points along a segment with a strong gradient within 1 px (`strong` is pre-dilated). */
function sideSupport(strong: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): number {
  const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
  let hits = 0;
  for (let i = 0; i <= steps; i++) {
    const x = Math.floor(x0 + ((x1 - x0) * i) / steps);
    const y = Math.floor(y0 + ((y1 - y0) * i) / steps);
    if (x >= 0 && y >= 0 && x < w && y < h && strong[y * w + x]) hits++;
  }
  return hits / (steps + 1);
}

/** Card outlines in an RGBA frame, best first, in frame pixel coordinates. */
export function detectOutlines(rgba: ArrayLike<number>, width: number, height: number): Outline[] {
  const scale = Math.min(1, DETECT_SIZE / Math.max(width, height));
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(8, Math.round(height * scale));
  const planes = downscale(rgba, width, height, w, h);
  for (const p of planes) blur(p, w, h);
  const { magnitude, gxs, gys } = gradients(planes, w, h);

  const voteThreshold = Math.max(VOTE_FLOOR, percentile(magnitude, VOTE_PERCENTILE));
  const supportThreshold = Math.max(SUPPORT_FLOOR, percentile(magnitude, SUPPORT_PERCENTILE));
  const strong = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (magnitude[y * w + x] < supportThreshold) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && xx >= 0 && yy < h && xx < w) strong[yy * w + xx] = 1;
      }
    }
  }

  const lines = houghLines(magnitude, gxs, gys, w, h, voteThreshold);
  const vertical = pickLines(lines, 0);
  const horizontal = pickLines(lines, 1);
  const cx = w / 2, cy = h / 2;
  const slackX = w * CORNER_SLACK, slackY = h * CORNER_SLACK;
  const frameArea = w * h;
  const found: Outline[] = [];

  for (let li = 0; li < vertical.length; li++) {
    for (let ri = li + 1; ri < vertical.length; ri++) {
      const left = vertical[li], right = vertical[ri];
      if (right.position - left.position < w * 0.2) continue;
      for (let ti = 0; ti < horizontal.length; ti++) {
        for (let bi = ti + 1; bi < horizontal.length; bi++) {
          const top = horizontal[ti], bottom = horizontal[bi];
          if (bottom.position - top.position < h * 0.2) continue;
          const tl = intersect(left, top), tr = intersect(right, top), br = intersect(right, bottom), bl = intersect(left, bottom);
          if (!tl || !tr || !br || !bl) continue;
          const corners = [tl, tr, br, bl].map(([x, y]) => [x + cx, y + cy] as [number, number]);
          if (corners.some(([x, y]) => x < -slackX || y < -slackY || x > w + slackX || y > h + slackY)) continue;
          const [p0, p1, p2, p3] = corners;
          const topLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          const bottomLen = Math.hypot(p2[0] - p3[0], p2[1] - p3[1]);
          const leftLen = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
          const rightLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
          const aspect = (topLen + bottomLen) / (leftLen + rightLen);
          if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) continue;
          if (Math.abs(topLen - bottomLen) > MAX_SIDE_DIFF * Math.max(topLen, bottomLen)) continue;
          if (Math.abs(leftLen - rightLen) > MAX_SIDE_DIFF * Math.max(leftLen, rightLen)) continue;
          let twice = 0;
          for (let i = 0; i < 4; i++) {
            const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
            twice += ax * by - bx * ay;
          }
          const area = Math.abs(twice) / 2 / frameArea;
          if (area < MIN_AREA) continue;
          const supports = [0, 1, 2, 3].map((i) => {
            const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
            return sideSupport(strong, w, h, ax, ay, bx, by);
          });
          const minSupport = Math.min(...supports);
          if (minSupport < MIN_SIDE_SUPPORT) continue;
          const mean = (supports[0] + supports[1] + supports[2] + supports[3]) / 4;
          const fit = Math.max(0, 1 - 2 * Math.abs(aspect - CARD_ASPECT));
          const quad = corners.flatMap(([x, y]) => [(x * width) / w, (y * height) / h]) as unknown as Quad;
          found.push({ quad, score: mean * Math.sqrt(minSupport) * fit * area * area, shape: mean * fit, support: mean, aspect });
        }
      }
    }
  }

  // Best by score, then best by shape alone (a smaller card may score lower but look right), deduplicated.
  const tolerance = 0.02 * Math.hypot(width, height);
  const same = (a: Quad, b: Quad) => {
    for (let i = 0; i < 8; i += 2) if (Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]) > tolerance) return false;
    return true;
  };
  const out: Outline[] = [];
  const add = (list: Outline[], count: number) => {
    let added = 0;
    for (const o of list) {
      if (added >= count) break;
      if (out.some((k) => same(k.quad, o.quad))) continue;
      out.push(o);
      added++;
    }
  };
  add([...found].sort((a, b) => b.score - a.score), OUTLINES_BY_SCORE);
  add([...found].sort((a, b) => b.shape - a.shape), OUTLINES_BY_SHAPE);
  return out;
}
