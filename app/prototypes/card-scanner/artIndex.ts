// Loads the Scryfall artwork hash index and finds the nearest artworks for a set of query hashes.

import { HASH_WORDS, popcount, type ArtHash } from "@/lib/cards/art-hash";
import { ART_INDEX_URL } from "./data";
import type { ArtCandidate } from "./types";

export type ArtIndex = {
  hashes: Uint32Array;
  /** [scryfall printing id, oracle id, name, face index] per entry. */
  cards: [string, string, string, number][];
  generatedAt: string;
};

type RawIndex = { version: number; generatedAt: string; count: number; hashes: string; cards: [string, string, string, number][] };

let pending: Promise<ArtIndex> | null = null;

function decode(base64: string): Uint32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4));
}

/** Fetches and decodes the index once per page load (the browser caches the file). */
export function loadArtIndex(): Promise<ArtIndex> {
  if (!pending) {
    pending = fetch(ART_INDEX_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`index ${response.status}`);
        return response.json() as Promise<RawIndex>;
      })
      .then((raw) => {
        if (raw.version !== 2 || !Array.isArray(raw.cards) || typeof raw.hashes !== "string") throw new Error("index format");
        const hashes = decode(raw.hashes);
        if (hashes.length !== raw.cards.length * HASH_WORDS) throw new Error("index size");
        return { hashes, cards: raw.cards, generatedAt: raw.generatedAt };
      });
    pending.catch(() => { pending = null; });
  }
  return pending;
}

/**
 * Nearest artworks to any of the query fingerprints (each entry scored by its best query), best first,
 * and the index of the query that produced the overall best match.
 * Brute force over ~50k entries × ~30 queries of 128-bit XOR + popcount: tens of milliseconds on a phone.
 */
export function searchArt(index: ArtIndex, queries: ArtHash[], limit = 8): { candidates: ArtCandidate[]; bestQuery: number } {
  const { hashes, cards } = index;
  const best: { entry: number; distance: number; query: number }[] = [];
  let cutoff = 129;
  for (let entry = 0; entry < cards.length; entry++) {
    const o = entry * HASH_WORDS;
    const h0 = hashes[o], h1 = hashes[o + 1], h2 = hashes[o + 2], h3 = hashes[o + 3];
    let distance = 129;
    let query = 0;
    for (let q = 0; q < queries.length; q++) {
      const k = queries[q];
      const d = popcount((h0 ^ k[0]) >>> 0) + popcount((h1 ^ k[1]) >>> 0) + popcount((h2 ^ k[2]) >>> 0) + popcount((h3 ^ k[3]) >>> 0);
      if (d < distance) {
        distance = d;
        query = q;
      }
    }
    if (distance >= cutoff) continue;
    best.push({ entry, distance, query });
    best.sort((a, b) => a.distance - b.distance);
    if (best.length > limit) best.pop();
    if (best.length === limit) cutoff = best[best.length - 1].distance;
  }
  const candidates = best.map(({ entry, distance }) => {
    const [printingId, oracleId, name] = cards[entry];
    return { printingId, oracleId, name, distance };
  });
  return { candidates, bestQuery: best[0]?.query ?? 0 };
}

/** Merges candidate lists, keeping each printing's closest distance, best first. */
export function mergeCandidates(...lists: ArtCandidate[][]): ArtCandidate[] {
  const byPrinting = new Map<string, ArtCandidate>();
  for (const candidate of lists.flat()) {
    const known = byPrinting.get(candidate.printingId);
    if (!known || candidate.distance < known.distance) byPrinting.set(candidate.printingId, candidate);
  }
  return [...byPrinting.values()].sort((a, b) => a.distance - b.distance);
}
