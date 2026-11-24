// Scanner v1 (?scanner=v1, kept for side-by-side comparison): the original art-window search, unchanged
// except that it now runs in the worker, sampling an OffscreenCanvas holding the posted frame instead of
// the <video> element. Gates, placements, and votes all live here, so the page only presents decisions.

import { artRect } from "@/lib/cards/art-hash";
import { loadArtIndex, mergeCandidates, searchArt, type ArtIndex } from "./artIndex";
import { decidePhoto, EMPTY_VOTES, recordFrame, type Decision, type VoteState } from "./autoScanV1";
import { MIN_TEXTURE, MOVING_DIFF, SCENE_CHANGE_DIFF, SHARPNESS_RATIO } from "./data";
import type { Rect } from "./geometry";
import { coarsePlacements, containedCard, frameQuality, hashPlacements, meanAbsDiff, refinePlacements, sampleGray, type Canvas2D } from "./scanner";
import type { ArtCandidate, ScanHint } from "./types";

export type V1Result = { hint: ScanHint; decision: Decision | null; best: ArtCandidate | null };

const FRAME_SAMPLE = { width: 36, height: 50 };
const SHARP_SAMPLE = { width: 96, height: 64 };
const COARSE = coarsePlacements();

function context(): Canvas2D {
  const c = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  if (!c) throw new Error("no 2d context");
  return c;
}

function matchFrame(index: ArtIndex, ctx: Canvas2D, source: OffscreenCanvas, card: Rect): ArtCandidate[] {
  const coarse = searchArt(index, hashPlacements(ctx, source, card, COARSE));
  const fine = searchArt(index, hashPlacements(ctx, source, card, refinePlacements(COARSE[coarse.bestQuery])));
  return mergeCandidates(coarse.candidates, fine.candidates);
}

export class V1Engine {
  private index: ArtIndex | null = null;
  private readonly frame = new OffscreenCanvas(1, 1);
  private readonly frameContext = this.frame.getContext("2d", { willReadFrequently: true })!;
  private readonly sample = context();
  private readonly hash = context();
  private previous: Uint8ClampedArray | null = null;
  private motion = 0;
  private maxSharpness = 0;
  private votes: VoteState = EMPTY_VOTES;
  private surfacedScene: Uint8ClampedArray | null = null;

  async load(): Promise<{ entries: number }> {
    this.index = await loadArtIndex();
    return { entries: this.index.cards.length };
  }

  reset() {
    this.previous = null;
    this.motion = 0;
    this.maxSharpness = 0;
    this.votes = EMPTY_VOTES;
    this.surfacedScene = null;
  }

  private put(pixels: Uint8ClampedArray, width: number, height: number) {
    this.frame.width = width;
    this.frame.height = height;
    this.frameContext.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  }

  /** The original per-tick step: motion, scene change, texture, and sharpness gates, then match and vote. */
  analyze(pixels: Uint8ClampedArray, width: number, height: number, guide: Rect): V1Result {
    const index = this.index;
    if (!index) return { hint: "loading", decision: null, best: null };
    this.put(pixels, width, height);
    const frameGray = sampleGray(this.sample, this.frame, guide, FRAME_SAMPLE.width, FRAME_SAMPLE.height);
    const diff = this.previous ? meanAbsDiff(this.previous, frameGray) : 0;
    this.previous = frameGray;
    this.motion = this.motion * 0.5 + diff * 0.5;

    if (this.surfacedScene) {
      if (meanAbsDiff(this.surfacedScene, frameGray) <= SCENE_CHANGE_DIFF) return { hint: "surfaced", decision: null, best: null };
      this.surfacedScene = null;
      this.votes = EMPTY_VOTES;
      this.maxSharpness = 0;
    }
    if (this.motion > MOVING_DIFF) return { hint: "moving", decision: null, best: null };

    const quality = frameQuality(sampleGray(this.sample, this.frame, artRect(guide), SHARP_SAMPLE.width, SHARP_SAMPLE.height), SHARP_SAMPLE.width, SHARP_SAMPLE.height);
    if (quality.texture < MIN_TEXTURE) return { hint: "searching", decision: null, best: null };
    this.maxSharpness = Math.max(quality.sharpness, this.maxSharpness * 0.97);
    if (quality.sharpness < this.maxSharpness * SHARPNESS_RATIO) return { hint: "matching", decision: null, best: null };

    const candidates = matchFrame(index, this.hash, this.frame, guide);
    const { state, decision } = recordFrame(this.votes, candidates);
    this.votes = state;
    if (decision.kind === "wait") return { hint: decision.leading ? "matching" : "searching", decision: null, best: candidates[0] ?? null };
    this.surfacedScene = frameGray;
    this.votes = EMPTY_VOTES;
    return { hint: "surfaced", decision, best: candidates[0] ?? null };
  }

  photo(pixels: Uint8ClampedArray, width: number, height: number): Decision {
    if (!this.index) throw new Error("index not loaded");
    this.put(pixels, width, height);
    return decidePhoto(matchFrame(this.index, this.hash, this.frame, containedCard({ width, height })));
  }
}
