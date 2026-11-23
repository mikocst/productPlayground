// Server-only Commander Spellbook wrapper. https://backend.commanderspellbook.com/
// Credential-free and rate limited, so pages are cached for an hour.

import { arr, cached, fetchJson, num, obj, str, type Json } from "./http";
import type { Combo, ComboCard, CombosResponse } from "./types";

const API = "https://backend.commanderspellbook.com";
const SITE = "https://commanderspellbook.com";
const SERVICE = "Commander Spellbook";
const ONE_HOUR = 60 * 60 * 1000;
export const MAX_COMBO_PAGE = 30;

const ZONES: Record<string, string> = { B: "Battlefield", H: "Hand", G: "Graveyard", E: "Exile", L: "Library", C: "Command zone" };

function lines(value: unknown): string[] {
  return (str(value) ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function toCard(use: Json): ComboCard {
  const card = obj(use.card);
  return {
    name: str(card.name) ?? "Unknown card",
    oracleId: str(card.oracleId),
    image: str(card.imageUriFrontSmall),
    zones: arr(use.zoneLocations).map((z) => ZONES[String(z)] ?? "").filter(Boolean),
  };
}

function toCombo(raw: Json): Combo | null {
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    url: `${SITE}/combo/${encodeURIComponent(id)}/`,
    cards: arr(raw.uses).map(obj).map(toCard),
    requires: arr(raw.requires).map((r) => str(obj(obj(r).template).name)).filter((n): n is string => !!n),
    produces: arr(raw.produces).map((p) => str(obj(obj(p).feature).name)).filter((n): n is string => !!n),
    prerequisites: [...lines(raw.easyPrerequisites), ...lines(raw.notablePrerequisites)],
    description: str(raw.description) ?? "",
    identity: str(raw.identity) ?? "C",
    commanderLegal: obj(raw.legalities).commander === true,
    popularity: num(raw.popularity),
    status: str(raw.status) ?? "",
  };
}

/**
 * Combos containing the card, ranked by Spellbook popularity (deck inclusion count), descending.
 * Results are filtered to variants that actually use the requested oracle card.
 */
export function getCombos(oracleId: string, cardName: string, offset: number, limit: number): Promise<CombosResponse> {
  const name = cardName.split(" // ")[0].replace(/"/g, "").trim().slice(0, 141);
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), MAX_COMBO_PAGE);
  const safeOffset = Math.max(0, Math.floor(offset));
  return cached(`combos:${oracleId}:${safeOffset}:${safeLimit}`, ONE_HOUR, async () => {
    const q = encodeURIComponent(`card:"${name}"`);
    const page = obj(await fetchJson(`${API}/variants/?q=${q}&ordering=-popularity&limit=${safeLimit}&offset=${safeOffset}`, SERVICE, 15000));
    const combos = arr(page.results)
      .map(obj)
      .map(toCombo)
      .filter((combo): combo is Combo => combo !== null && combo.cards.some((card) => card.oracleId === oracleId));
    return {
      combos,
      nextOffset: str(page.next) ? safeOffset + safeLimit : null,
      fetchedAt: new Date().toISOString(),
    };
  });
}
