// Scanner v1 (?scanner=v1) decision logic: turns per-frame artwork matches into open / confirm / surface decisions.
// One frame opens a card only when its match is close and far ahead of any other card; otherwise the same
// card must win several recent frames. Weaker matches are only ever offered as a question.

import {
  ART_ACCEPT_DISTANCE,
  ART_GUESS_DISTANCE,
  ART_MARGIN,
  ART_VOTE_DISTANCE,
  MAX_SCENE_FRAMES,
  VOTE_MARGIN,
  VOTE_WINDOW,
  VOTES_TO_OPEN,
} from "./data";
import type { ArtCandidate } from "./types";

export type VoteState = { recent: (ArtCandidate | null)[]; cardFrames: number; seen: ArtCandidate[] };

export type Decision =
  | { kind: "open"; match: ArtCandidate }
  | { kind: "confirm"; match: ArtCandidate; others: string[] }
  | { kind: "surface"; others: string[] }
  | { kind: "wait"; leading: ArtCandidate | null };

export const EMPTY_VOTES: VoteState = { recent: [], cardFrames: 0, seen: [] };

/** Distinct card names from candidates within guess range, best first, excluding `skip`. */
function names(candidates: ArtCandidate[], skip?: string): string[] {
  return [...new Set(candidates.filter((c) => c.oracleId !== skip && c.distance <= ART_GUESS_DISTANCE).map((c) => c.name))].slice(0, 5);
}

/** Best candidate, and how far ahead it is of the closest *different* card. */
export function lead(candidates: ArtCandidate[]): { best: ArtCandidate | null; margin: number } {
  const best = candidates[0] ?? null;
  if (!best) return { best: null, margin: 0 };
  const rival = candidates.find((c) => c.oracleId !== best.oracleId);
  return { best, margin: (rival?.distance ?? 128) - best.distance };
}

/** Records one frame's nearest artworks (best first) and decides what to do. */
export function recordFrame(state: VoteState, candidates: ArtCandidate[]): { state: VoteState; decision: Decision } {
  const { best, margin } = lead(candidates);
  const vote = best && best.distance <= ART_VOTE_DISTANCE && margin >= VOTE_MARGIN ? best : null;
  const plausible = !!best && best.distance <= ART_GUESS_DISTANCE;

  const next: VoteState = {
    recent: [...state.recent, vote].slice(-VOTE_WINDOW),
    cardFrames: state.cardFrames + 1,
    seen: plausible ? [...state.seen, ...candidates.slice(0, 3)].sort((a, b) => a.distance - b.distance).slice(0, 12) : state.seen,
  };

  if (best && best.distance <= ART_ACCEPT_DISTANCE && margin >= ART_MARGIN) {
    return { state: next, decision: { kind: "open", match: best } };
  }

  if (vote) {
    const agreeing = next.recent.filter((c): c is ArtCandidate => !!c && c.oracleId === vote.oracleId);
    if (agreeing.length >= VOTES_TO_OPEN) {
      const closest = agreeing.reduce((a, b) => (b.distance < a.distance ? b : a));
      return { state: next, decision: { kind: "open", match: closest } };
    }
  }

  if (next.cardFrames >= MAX_SCENE_FRAMES) {
    const top = next.seen[0];
    return {
      state: next,
      decision: top ? { kind: "confirm", match: top, others: names(next.seen, top.oracleId) } : { kind: "surface", others: [] },
    };
  }

  return { state: next, decision: { kind: "wait", leading: vote ?? (plausible ? best : null) } };
}

/** Single-shot decision for an uploaded photo (no later frames to vote with). */
export function decidePhoto(candidates: ArtCandidate[]): Decision {
  const { best, margin } = lead(candidates);
  if (!best || best.distance > ART_GUESS_DISTANCE) return { kind: "surface", others: [] };
  if (best.distance <= ART_VOTE_DISTANCE && margin >= ART_MARGIN) return { kind: "open", match: best };
  return { kind: "confirm", match: best, others: names(candidates, best.oracleId) };
}
