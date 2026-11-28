// Server-only Card Kingdom prices from its public price list (https://api.cardkingdom.com/api/v2/pricelist).
// The list covers every product (~70 MB) and is keyed by Scryfall printing id, so it is downloaded at most
// every few hours and reduced to a compact lookup table in memory.

import { arr, cached, obj, str, UpstreamError } from "./http";
import type { CardKingdomOffer, CardKingdomResponse } from "./types";

const PRICELIST = "https://api.cardkingdom.com/api/v2/pricelist";
const SERVICE = "Card Kingdom";
const USER_AGENT = "PrototypePlayground/0.1 (card-scanner prototype)";
const SIX_HOURS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 45_000;
const MAX_BYTES = 200 * 1024 * 1024;

type Offers = { nonfoil: CardKingdomOffer | null; foil: CardKingdomOffer | null };
type PriceTable = { offers: Map<string, Offers>; updatedAt: string | null };

async function loadPriceTable(): Promise<PriceTable> {
  let response: Response;
  try {
    response = await fetch(PRICELIST, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new UpstreamError(504, `${SERVICE} prices did not load. Try again shortly.`);
  }
  if (response.status === 429) throw new UpstreamError(429, `${SERVICE} is rate limiting requests. Wait a moment and retry.`);
  if (!response.ok) throw new UpstreamError(502, `${SERVICE} prices are unavailable right now.`);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new UpstreamError(502, `${SERVICE} returned more data than expected.`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new UpstreamError(502, `${SERVICE} returned an unreadable price list.`);
  }
  const root = obj(body);
  const base = str(obj(root.meta).base_url) ?? "https://www.cardkingdom.com/";
  const offers = new Map<string, Offers>();
  for (const item of arr(root.data).map(obj)) {
    const id = str(item.scryfall_id);
    const price = str(item.price_retail);
    const path = str(item.url);
    if (!id || !price || !path || Number(price) <= 0) continue;
    const offer: CardKingdomOffer = { price, url: new URL(path, base).toString(), inStock: Number(item.qty_retail) > 0 };
    const entry = offers.get(id) ?? { nonfoil: null, foil: null };
    if (item.is_foil === "true" || item.is_foil === true) entry.foil = offer;
    else entry.nonfoil = offer;
    offers.set(id, entry);
  }
  if (!offers.size) throw new UpstreamError(502, `${SERVICE} returned an empty price list.`);
  return { offers, updatedAt: str(obj(root.meta).created_at) };
}

export async function getCardKingdomPrices(printingId: string): Promise<CardKingdomResponse> {
  const table = await cached("card-kingdom:pricelist", SIX_HOURS, loadPriceTable);
  const offers = table.offers.get(printingId);
  return { nonfoil: offers?.nonfoil ?? null, foil: offers?.foil ?? null, updatedAt: table.updatedAt };
}
