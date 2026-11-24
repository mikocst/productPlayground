// Scanner v2 decision rules: turns per-frame analyses into open / confirm / surface decisions. Pure.
//
// The index is grouped by card, so every frame's runner-up is the closest *different card*, and the margin
// between them measures how unambiguous the frame is.
//   instant  one frame within INSTANT_DISTANCE and INSTANT_MARGIN ahead
//   streak   STREAK_TO_OPEN confident frames on the same card (an unconfident frame that still leads with
//            that card neither counts nor breaks the streak; anything else breaks it)
//   confirm  MAX_OUTLINED_FRAMES outlined frames without a decision: the closest card seen, if within
//            GUESS_DISTANCE, is offered as "Is this…?"; otherwise "Couldn't match"
//   re-arm   a card just offered is ignored until it has been out of view REARM_MISSES frames in a row

import {
  GLARE_HINT_MS,
  GUESS_DISTANCE,
  INSTANT_DISTANCE,
  INSTANT_MARGIN,
  MAX_OUTLINED_FRAMES,
  REARM_MISSES,
  STREAK_TO_OPEN,
} from "./data";
import type { ArtCandidate, FrameAnalysis, FrameMatch, ScanHint } from "./types";

export type ScanState = {
  streak: { nameIndex: number; frames: FrameMatch[] } | null;
  /** Outlined frames since the last decision. */
  outlined: number;
  /** When the current run of outlined-but-unconfident frames started. */
  unsureSince: number | null;
  /** Closest distinct cards seen since the last decision, best first. */
  seen: FrameMatch[];
  /** The card last offered, ignored until it leaves the view. */
  blocked: { nameIndex: number; misses: number } | null;
};

export type Decision =
  | { kind: "open"; match: ArtCandidate }
  | { kind: "confirm"; match: ArtCandidate; others: string[] }
  | { kind: "surface"; others: string[] }
  | { kind: "wait"; hint: ScanHint };

export const EMPTY_SCAN: ScanState = { streak: null, outlined: 0, unsureSince: null, seen: [], blocked: null };

const toCandidate = (m: FrameMatch): ArtCandidate => ({ printingId: m.printingId, oracleId: m.oracleId, name: m.name, distance: m.distance });
const marginOf = (a: FrameAnalysis) => (a.best ? (a.runnerUp?.distance ?? 256) - a.best.distance : 0);

function remember(seen: FrameMatch[], match: FrameMatch): FrameMatch[] {
  const known = seen.find((m) => m.nameIndex === match.nameIndex);
  if (known && known.distance <= match.distance) return seen;
  return [...seen.filter((m) => m.nameIndex !== match.nameIndex), match].sort((a, b) => a.distance - b.distance).slice(0, 8);
}

/** After a decision: reset the votes and block the decided card until it leaves the view. */
function decided(state: ScanState, nameIndex: number | null): ScanState {
  return { ...EMPTY_SCAN, blocked: nameIndex === null ? null : { nameIndex, misses: 0 } };
}

/** Records one frame and decides what to do. `now` is a timestamp in ms (for the glare hint). */
export function recordFrame(state: ScanState, analysis: FrameAnalysis, now: number): { state: ScanState; decision: Decision } {
  const best = analysis.best;
  const plausible = !!best && best.distance <= GUESS_DISTANCE;

  if (state.blocked) {
    if (plausible && best!.nameIndex === state.blocked.nameIndex) {
      return { state: { ...state, blocked: { ...state.blocked, misses: 0 } }, decision: { kind: "wait", hint: "surfaced" } };
    }
    const misses = state.blocked.misses + 1;
    state = { ...state, blocked: misses >= REARM_MISSES ? null : { ...state.blocked, misses } };
    if (state.blocked) return { state, decision: { kind: "wait", hint: "surfaced" } };
  }

  if (!analysis.hasOutline && !analysis.confident) {
    return { state: { ...state, streak: null, unsureSince: null }, decision: { kind: "wait", hint: "searching" } };
  }

  const seen = plausible ? remember(state.seen, best!) : state.seen;
  const outlined = state.outlined + 1;

  if (best && analysis.confident && best.distance <= INSTANT_DISTANCE && marginOf(analysis) >= INSTANT_MARGIN) {
    return { state: decided(state, best.nameIndex), decision: { kind: "open", match: toCandidate(best) } };
  }

  let streak = state.streak;
  if (best && analysis.confident) {
    streak = streak && streak.nameIndex === best.nameIndex ? { nameIndex: best.nameIndex, frames: [...streak.frames, best] } : { nameIndex: best.nameIndex, frames: [best] };
    if (streak.frames.length >= STREAK_TO_OPEN) {
      const closest = streak.frames.reduce((a, b) => (b.distance < a.distance ? b : a));
      return { state: decided(state, best.nameIndex), decision: { kind: "open", match: toCandidate(closest) } };
    }
  } else if (!(streak && plausible && best!.nameIndex === streak.nameIndex)) {
    streak = null;
  }

  if (outlined >= MAX_OUTLINED_FRAMES) {
    const top = seen[0];
    const others = seen.filter((m) => m !== top).map((m) => m.name).slice(0, 5);
    return top
      ? { state: decided(state, top.nameIndex), decision: { kind: "confirm", match: toCandidate(top), others } }
      : { state: decided(state, null), decision: { kind: "surface", others: [] } };
  }

  const unsureSince = analysis.confident ? null : state.unsureSince ?? now;
  const hint: ScanHint = unsureSince !== null && now - unsureSince > GLARE_HINT_MS ? "glare" : "matching";
  return { state: { ...state, streak, outlined, unsureSince, seen }, decision: { kind: "wait", hint } };
}

/** Single-shot decision for an uploaded photo (no later frames to vote with). */
export function decidePhoto(analysis: FrameAnalysis): Decision {
  const best = analysis.best;
  if (!best || best.distance > GUESS_DISTANCE) return { kind: "surface", others: [] };
  if (analysis.confident) return { kind: "open", match: toCandidate(best) };
  return { kind: "confirm", match: toCandidate(best), others: analysis.runnerUp && analysis.runnerUp.distance <= GUESS_DISTANCE ? [analysis.runnerUp.name] : [] };
}
