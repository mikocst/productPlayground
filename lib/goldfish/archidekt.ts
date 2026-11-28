// Server-only deck URL adapters. Each returns the same DeckLine shape the text parser produces.
// Archidekt has public deck JSON; Moxfield blocks other sites, so its links get a paste instruction instead.

import type { DeckLine, ImportResult } from "@/app/prototypes/goldfish-tester/types";
import { arr, cached, fetchJson, num, obj, str, UpstreamError } from "./http";

const TEN_MINUTES = 10 * 60 * 1000;

export function parseDeckUrl(input: string): { site: "archidekt"; id: string } | { site: "moxfield" } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "moxfield.com") return { site: "moxfield" };
  if (host === "archidekt.com") {
    const id = url.pathname.match(/^\/(?:api\/)?decks\/(\d{1,12})/)?.[1];
    return id ? { site: "archidekt", id } : null;
  }
  return null;
}

/** Archidekt descriptions are rich text; keep only readable lines. */
function plainText(value: unknown): string | undefined {
  const text = str(value);
  if (!text) return undefined;
  let out = text;
  try {
    const ops = arr(obj(JSON.parse(text)).ops);
    if (ops.length) out = ops.map((op) => (typeof obj(op).insert === "string" ? String(obj(op).insert) : "")).join("");
  } catch {
    // Already plain text.
  }
  out = out.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim();
  return out ? out.slice(0, 4000) : undefined;
}

export function importArchidekt(id: string): Promise<ImportResult> {
  return cached(`archidekt:${id}`, TEN_MINUTES, async () => {
    let raw;
    try {
      raw = obj(await fetchJson(`https://archidekt.com/api/decks/${id}/`, "Archidekt"));
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 404) throw new UpstreamError(404, "Archidekt has no public deck at that link.");
      throw error;
    }
    const outside = new Set(arr(raw.categories).map(obj).filter((c) => c.includedInDeck === false).map((c) => str(c.name)));
    const lines: DeckLine[] = [];
    for (const entry of arr(raw.cards).map(obj)) {
      const card = obj(entry.card);
      const name = str(obj(card.oracleCard).name);
      if (!name) continue;
      const categories = arr(entry.categories).map(String);
      const section = categories.includes("Commander") ? "commander" : categories.some((c) => outside.has(c)) ? "sideboard" : "deck";
      const set = str(obj(card.edition).editioncode);
      const collectorNumber = str(card.collectorNumber);
      lines.push({ qty: Math.max(1, num(entry.quantity) ?? 1), name, section, ...(set ? { set } : {}), ...(collectorNumber ? { collectorNumber } : {}) });
    }
    if (!lines.length) throw new UpstreamError(422, "That Archidekt deck has no cards.");
    return { lines, title: str(raw.name) ?? undefined, primer: plainText(raw.description) };
  });
}
