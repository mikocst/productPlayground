// Server-only Scryfall resolver for decklists. https://scryfall.com/docs/api
// 1. /cards/collection in batches of 75 (set + collector number when given, else exact name).
// 2. /cards/named?fuzzy= for misses: catches typos and reflavored names (Endwalker → Brainstorm).
// 3. /cards/autocomplete suggestions for what still misses.
// Requests are spaced 120 ms apart, inside Scryfall's 10-per-second guidance.

import type { CardData, ResolveMiss, ResolveResponse } from "@/app/prototypes/goldfish-tester/types";
import { arr, cached, fetchJson, num, obj, sleep, str, UpstreamError, type Json } from "./http";

const API = "https://api.scryfall.com";
const SERVICE = "Scryfall";
const ONE_DAY = 24 * 60 * 60 * 1000;
const GAP_MS = 120;
const MAX_FUZZY = 25;

export type LookupLine = { name: string; set?: string; collectorNumber?: string };

function toCard(raw: Json): CardData | null {
  const faces = arr(raw.card_faces).map(obj);
  const oracleId = str(raw.oracle_id) ?? str(faces[0]?.oracle_id);
  const name = str(raw.name);
  if (!oracleId || !name) return null;
  const layout = str(raw.layout) ?? "";
  const back = layout === "modal_dfc" || layout === "transform" ? str(faces[1]?.type_line) : null;
  return {
    oracleId,
    name,
    cmc: num(raw.cmc) ?? 0,
    manaCost: str(raw.mana_cost) ?? str(faces[0]?.mana_cost) ?? "",
    typeLine: str(raw.type_line) ?? str(faces[0]?.type_line) ?? "",
    ...(back ? { backTypeLine: back } : {}),
    oracleText: str(raw.oracle_text) ?? faces.map((f) => str(f.oracle_text) ?? "").join("\n"),
    producedMana: arr(raw.produced_mana).filter((m): m is string => typeof m === "string"),
    keywords: arr(raw.keywords).filter((k): k is string => typeof k === "string"),
  };
}

const nameKey = (s: string) => s.trim().toLowerCase();
const printKey = (set: string, cn: string) => `${set.toLowerCase()}:${cn.toLowerCase()}`;

/** Every key a collection result can be matched back by. */
function keysOf(raw: Json): string[] {
  const keys = [str(raw.name), ...arr(raw.card_faces).map((f) => str(obj(f).name)), str(raw.flavor_name), str(raw.printed_name)]
    .filter((k): k is string => !!k)
    .map(nameKey);
  const set = str(raw.set);
  const cn = str(raw.collector_number);
  if (set && cn) keys.push(printKey(set, cn));
  return keys;
}

async function collection(identifiers: Json[]): Promise<Map<string, CardData>> {
  const found = new Map<string, CardData>();
  for (let i = 0; i < identifiers.length; i += 75) {
    if (i > 0) await sleep(GAP_MS);
    const page = obj(await fetchJson(`${API}/cards/collection`, SERVICE, { method: "POST", body: { identifiers: identifiers.slice(i, i + 75) } }));
    for (const raw of arr(page.data).map(obj)) {
      const card = toCard(raw);
      if (card) for (const k of keysOf(raw)) found.set(k, card);
    }
  }
  return found;
}

function fuzzy(name: string): Promise<CardData | null> {
  return cached(`fuzzy:${nameKey(name)}`, ONE_DAY, async () => {
    try {
      return toCard(obj(await fetchJson(`${API}/cards/named?fuzzy=${encodeURIComponent(name.slice(0, 141))}`, SERVICE)));
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 404) return null;
      throw error;
    }
  });
}

async function suggestions(name: string): Promise<string[]> {
  const words = name.split(/\s+/).slice(0, 2).join(" ");
  if (words.length < 2) return [];
  try {
    const raw = obj(await fetchJson(`${API}/cards/autocomplete?q=${encodeURIComponent(words)}`, SERVICE));
    return arr(raw.data).filter((n): n is string => typeof n === "string").slice(0, 5);
  } catch {
    return [];
  }
}

const resolved = new Map<string, { expires: number; card: CardData }>();
const remember = (key: string, card: CardData) => resolved.set(key, { expires: Date.now() + ONE_DAY, card });
const recall = (key: string) => {
  const hit = resolved.get(key);
  return hit && hit.expires > Date.now() ? hit.card : null;
};

export async function resolveLines(lines: LookupLine[]): Promise<ResolveResponse> {
  const out: (CardData | null)[] = lines.map((l) => recall(l.set && l.collectorNumber ? printKey(l.set, l.collectorNumber) : nameKey(l.name)) ?? recall(nameKey(l.name)));

  // Pass 1: collection lookups for everything not cached.
  const pending = lines.map((l, i) => ({ l, i })).filter(({ i }) => !out[i]);
  if (pending.length) {
    const ids = new Map<string, Json>();
    for (const { l } of pending) {
      if (l.set && l.collectorNumber) ids.set(printKey(l.set, l.collectorNumber), { set: l.set, collector_number: l.collectorNumber });
      ids.set(nameKey(l.name), { name: l.name });
    }
    const found = await collection([...ids.values()]);
    for (const { l, i } of pending) {
      const card = (l.set && l.collectorNumber ? found.get(printKey(l.set, l.collectorNumber)) : undefined) ?? found.get(nameKey(l.name)) ?? null;
      if (card) {
        out[i] = card;
        remember(nameKey(l.name), card);
        if (l.set && l.collectorNumber) remember(printKey(l.set, l.collectorNumber), card);
      }
    }
  }

  // Pass 2: fuzzy lookups, one unique name at a time.
  const misses: ResolveMiss[] = [];
  const missing = [...new Set(lines.filter((_, i) => !out[i]).map((l) => l.name))];
  for (const [k, name] of missing.entries()) {
    if (k >= MAX_FUZZY) { misses.push({ query: name, suggestions: [] }); continue; }
    if (k > 0) await sleep(GAP_MS);
    const card = await fuzzy(name);
    if (card) {
      remember(nameKey(name), card);
      lines.forEach((l, i) => { if (!out[i] && l.name === name) out[i] = card; });
    } else {
      await sleep(GAP_MS);
      misses.push({ query: name, suggestions: await suggestions(name) });
    }
  }
  return { cards: out, misses };
}
