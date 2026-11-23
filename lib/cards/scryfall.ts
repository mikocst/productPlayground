// Server-only Scryfall wrapper. https://scryfall.com/docs/api
// Scryfall asks for 50–100 ms between requests and a descriptive User-Agent (see http.ts).

import { arr, cached, fetchJson, obj, sleep, str, UpstreamError, type Json } from "./http";
import type { CardFace, CardIdentity, CardResponse, Printing, PurchaseLink } from "./types";

const API = "https://api.scryfall.com";
const SERVICE = "Scryfall";
const TEN_MINUTES = 10 * 60 * 1000;
const MAX_PRINT_PAGES = 5; // 175 per page → 875 printings, well above any real card
const PURCHASE_LABELS: Record<string, string> = { tcgplayer: "TCGplayer", cardmarket: "Cardmarket", cardhoarder: "Cardhoarder" };

export const ORACLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toIdentity(raw: Json): CardIdentity {
  const oracleId = str(raw.oracle_id) ?? str(obj(arr(raw.card_faces)[0]).oracle_id);
  const name = str(raw.name);
  if (!oracleId || !name) throw new UpstreamError(502, "Scryfall returned an incomplete card.");
  return { oracleId, name, layout: str(raw.layout) ?? "normal", typeLine: str(raw.type_line) ?? "" };
}

function toFaces(raw: Json): CardFace[] {
  const top = obj(raw.image_uris);
  const faces = arr(raw.card_faces).map(obj);
  // Double-faced layouts keep images per face; split/flip/adventure cards share one top-level image.
  if (!str(top.large) && faces.some((face) => str(obj(face.image_uris).large))) {
    return faces.map((face) => ({ name: str(face.name) ?? "", image: str(obj(face.image_uris).large) }));
  }
  return [{ name: str(raw.name) ?? "", image: str(top.large) ?? str(top.normal) }];
}

function toPrinting(raw: Json): Printing {
  const prices = obj(raw.prices);
  const purchase = obj(raw.purchase_uris);
  const purchaseLinks: PurchaseLink[] = Object.entries(PURCHASE_LABELS)
    .map(([key, label]) => ({ label, url: str(purchase[key]) ?? "" }))
    .filter((link) => link.url.startsWith("https://"));
  return {
    id: str(raw.id) ?? "",
    set: (str(raw.set) ?? "").toUpperCase(),
    setName: str(raw.set_name) ?? "Unknown set",
    collectorNumber: str(raw.collector_number) ?? "",
    rarity: str(raw.rarity) ?? "",
    finishes: arr(raw.finishes).filter((f): f is string => typeof f === "string"),
    releasedAt: str(raw.released_at) ?? "",
    lang: str(raw.lang) ?? "en",
    faces: toFaces(raw),
    prices: {
      usd: str(prices.usd),
      usdFoil: str(prices.usd_foil),
      usdEtched: str(prices.usd_etched),
      eur: str(prices.eur),
      eurFoil: str(prices.eur_foil),
      tix: str(prices.tix),
    },
    scryfallUrl: str(raw.scryfall_uri) ?? "https://scryfall.com",
    purchaseLinks,
  };
}

/** Fuzzy name lookup used for OCR candidates and manual search. */
export function findCardByName(name: string): Promise<CardIdentity> {
  const query = name.trim().slice(0, 141);
  return cached(`named:${query.toLowerCase()}`, TEN_MINUTES, async () => {
    const raw = obj(await fetchJson(`${API}/cards/named?fuzzy=${encodeURIComponent(query)}`, SERVICE));
    return toIdentity(raw);
  });
}

export function autocomplete(query: string): Promise<string[]> {
  const q = query.trim().slice(0, 141);
  if (q.length < 2) return Promise.resolve([]);
  return cached(`auto:${q.toLowerCase()}`, TEN_MINUTES, async () => {
    const raw = obj(await fetchJson(`${API}/cards/autocomplete?q=${encodeURIComponent(q)}`, SERVICE));
    return arr(raw.data).filter((n): n is string => typeof n === "string").slice(0, 6);
  });
}

/** Every English, non-extra printing of an oracle card, newest first. */
export function getPrintings(oracleId: string): Promise<CardResponse> {
  if (!ORACLE_ID.test(oracleId)) return Promise.reject(new UpstreamError(404, "That card id is not valid."));
  return cached(`prints:${oracleId}`, TEN_MINUTES, async () => {
    const raws: Json[] = [];
    let url: string | null = `${API}/cards/search?q=${encodeURIComponent(`oracleid:${oracleId}`)}&unique=prints&order=released&dir=desc`;
    let pages = 0;
    let truncated = false;
    while (url) {
      if (pages > 0) await sleep(100);
      const page = obj(await fetchJson(url, SERVICE));
      raws.push(...arr(page.data).map(obj));
      pages++;
      const next = page.has_more === true ? str(page.next_page) : null;
      if (next && pages >= MAX_PRINT_PAGES) {
        truncated = true;
        break;
      }
      url = next && next.startsWith(`${API}/`) ? next : null;
    }
    if (raws.length === 0) throw new UpstreamError(404, "Scryfall has no printings for that card.");
    return {
      card: toIdentity(raws[0]),
      printings: raws.map(toPrinting).filter((p) => p.id),
      truncated,
      fetchedAt: new Date().toISOString(),
    };
  });
}
