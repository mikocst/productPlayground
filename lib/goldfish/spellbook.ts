// Server-only Commander Spellbook client. https://backend.commanderspellbook.com/
// find-my-combos sends no CORS headers, so the browser can't call it directly; this proxies it.

import type { CombosResponse, SpellbookCombo } from "@/app/prototypes/goldfish-tester/types";
import { arr, cached, fetchJson, num, obj, str, type Json } from "./http";

const API = "https://backend.commanderspellbook.com";
const SITE = "https://commanderspellbook.com";
const SERVICE = "Commander Spellbook";
const ONE_HOUR = 60 * 60 * 1000;
const PAGE = 100;
const MAX_PAGES = 3;

const lines = (value: unknown) => (str(value) ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

function toCombo(raw: Json): SpellbookCombo | null {
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    url: `${SITE}/combo/${encodeURIComponent(id)}/`,
    cards: arr(raw.uses).map(obj).map((u) => {
      const card = obj(u.card);
      return {
        name: str(card.name) ?? "Unknown card",
        oracleId: str(card.oracleId),
        zones: arr(u.zoneLocations).map(String),
        mustBeCommander: u.mustBeCommander === true,
      };
    }),
    manaNeeded: str(raw.manaNeeded) ?? "",
    manaValueNeeded: num(raw.manaValueNeeded) ?? 0,
    requires: arr(raw.requires).map(obj).map((r) => {
      const q = num(r.quantity) ?? 1;
      const name = str(obj(r.template).name) ?? "a card";
      return q > 1 ? `${q} × ${name}` : name;
    }),
    prerequisites: [...lines(raw.easyPrerequisites), ...lines(raw.notablePrerequisites)],
    produces: arr(raw.produces).map((p) => str(obj(obj(p).feature).name)).filter((n): n is string => !!n),
  };
}

export function findCombos(commanders: string[], main: string[]): Promise<CombosResponse> {
  const key = `fmc:${[...commanders].sort().join("|")}::${[...main].sort().join("|")}`;
  return cached(key, ONE_HOUR, async () => {
    const body = { commanders: commanders.map((card) => ({ card })), main: main.map((card) => ({ card })) };
    const included: SpellbookCombo[] = [];
    let almostIncluded = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = obj(await fetchJson(`${API}/find-my-combos?limit=${PAGE}&offset=${page * PAGE}`, SERVICE, { method: "POST", body, timeoutMs: 20000 }));
      const results = obj(data.results);
      included.push(...arr(results.included).map(obj).map(toCombo).filter((c): c is SpellbookCombo => c !== null));
      if (page === 0) almostIncluded = arr(results.almostIncluded).length;
      if (!str(data.next)) break;
    }
    const seen = new Set<string>();
    return { included: included.filter((c) => !seen.has(c.id) && seen.add(c.id)), almostIncluded };
  });
}
