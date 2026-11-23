import { NextResponse } from "next/server";
import { errorStatus, UpstreamError } from "@/lib/cards/http";
import { readSimilarity } from "@/lib/cards/match";
import { autocomplete, findCardByName } from "@/lib/cards/scryfall";
import type { CardIdentity, RecognizeResponse } from "@/lib/cards/types";

const MAX_CANDIDATES = 3;
const MAX_LENGTH = 80;
const CONFIDENT = 0.8;

/** Prefix guesses below this similarity are not offered as a match. */
const PREFIX_FLOOR = 0.5;

function parseBody(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const list = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(list)) return null;
  const clean = list
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH))
    .filter((item) => item.length >= 2);
  return clean.length ? [...new Set(clean)].slice(0, MAX_CANDIDATES) : null;
}

/** Typos can defeat fuzzy lookup ("Sol Rlng"), so autocomplete shrinking prefixes and rank by similarity. */
async function nearestByPrefix(candidate: string): Promise<{ names: string[]; best: { name: string; score: number } | null }> {
  const words = candidate.split(" ");
  const prefixes = [...new Set([
    candidate.slice(0, Math.ceil(candidate.length * 0.66)),
    candidate.slice(0, Math.ceil(candidate.length * 0.4)),
    words.length > 1 ? words[0] : "",
  ].map((p) => p.trim()).filter((p) => p.length >= 3))];

  for (const prefix of prefixes) {
    const names = await autocomplete(prefix).catch(() => []);
    if (!names.length) continue;
    const ranked = names.map((name) => ({ name, score: readSimilarity(candidate, name) })).sort((a, b) => b.score - a.score);
    return { names: ranked.map((r) => r.name), best: ranked[0].score >= PREFIX_FLOOR ? ranked[0] : null };
  }
  return { names: [], best: null };
}

/** Resolves typed name candidates to a single Scryfall oracle identity. */
export async function POST(request: Request) {
  let candidates: string[] | null;
  try {
    candidates = parseBody(await request.json());
  } catch {
    candidates = null;
  }
  if (!candidates) return NextResponse.json({ error: "Send at least one card name candidate." }, { status: 400 });

  try {
    let best: { card: CardIdentity; from: string; score: number; guess: boolean } | null = null;
    for (const candidate of candidates) {
      try {
        const card = await findCardByName(candidate);
        const score = readSimilarity(candidate, card.name);
        if (!best || score > best.score) best = { card, from: candidate, score, guess: false };
        if (score >= 0.98) break;
      } catch (error) {
        if (!(error instanceof UpstreamError && error.status === 404)) throw error;
      }
    }

    let nearby: string[] = [];
    if (!best || best.score < CONFIDENT) {
      const from = best?.from ?? candidates[0];
      const direct = await autocomplete(from).catch(() => []);
      const fallback = direct.length ? null : await nearestByPrefix(from);
      nearby = direct.length ? direct : fallback?.names ?? [];
      if (!best && fallback?.best) {
        const card = await findCardByName(fallback.best.name);
        best = { card, from, score: fallback.best.score, guess: true };
      }
    }
    const suggestions = nearby.filter((name) => name !== best?.card.name).slice(0, 5);

    const body: RecognizeResponse = best
      ? { status: "matched", card: best.card, matchedFrom: best.from, confidence: Number(best.score.toFixed(2)), guess: best.guess, suggestions }
      : { status: "no-match", suggestions };
    return NextResponse.json(body);
  } catch (error) {
    const { status, message } = errorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}
