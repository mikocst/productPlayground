// Client helpers for the card-scanner card routes. The browser never calls Scryfall's API directly.

import { API_BASE, FINISH_LABELS, RARITY_LABELS } from "./data";
import type { CardKingdomOffer, CardKingdomResponse, CardResponse, Printing, RecognizeResponse, StoreOffer } from "./types";

export class RequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function readJson<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // fall through to a generic error below
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : "The card service is unavailable right now.";
    throw new RequestError(response.status, message);
  }
  if (!body || typeof body !== "object") throw new RequestError(502, "The card service returned an unreadable response.");
  return body as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof RequestError) return error.message;
  return "Network error. Check your connection and retry.";
}

export async function recognizeName(candidates: string[], signal?: AbortSignal): Promise<RecognizeResponse> {
  const response = await fetch(`${API_BASE}/recognize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidates }),
    signal,
  });
  return readJson<RecognizeResponse>(response);
}

export async function fetchCard(oracleId: string, signal?: AbortSignal): Promise<CardResponse> {
  const response = await fetch(`${API_BASE}/card/${encodeURIComponent(oracleId)}`, { signal });
  return readJson<CardResponse>(response);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

export async function fetchCardKingdom(printingId: string, signal?: AbortSignal): Promise<CardKingdomResponse> {
  const response = await fetch(`${API_BASE}/card-kingdom/${encodeURIComponent(printingId)}`, { signal });
  return readJson<CardKingdomResponse>(response);
}

const money = (raw: string | null, format: Intl.NumberFormat) => (raw !== null && Number.isFinite(Number(raw)) ? format.format(Number(raw)) : null);
const rows = (pairs: [string, string | null][]) => pairs.filter((pair): pair is [string, string] => pair[1] !== null).map(([label, value]) => ({ label, value }));

/**
 * One entry per store for a printing. TCGplayer, Cardmarket, and Cardhoarder prices are the ones Scryfall
 * collects from those stores daily; Card Kingdom comes from Card Kingdom's own price list.
 */
export function storeOffers(printing: Printing, cardKingdom: CardKingdomResponse | null): StoreOffer[] {
  const { prices, storeLinks } = printing;
  const ck = (offer: CardKingdomOffer | null) => (offer ? `${money(offer.price, usd)}${offer.inStock ? "" : " (sold out)"}` : null);
  return [
    { store: "TCGplayer", url: storeLinks.tcgplayer, rows: rows([["Normal", money(prices.usd, usd)], ["Foil", money(prices.usdFoil, usd)], ["Etched", money(prices.usdEtched, usd)]]) },
    { store: "Card Kingdom", url: cardKingdom?.nonfoil?.url ?? cardKingdom?.foil?.url ?? null, rows: rows([["Normal", ck(cardKingdom?.nonfoil ?? null)], ["Foil", ck(cardKingdom?.foil ?? null)]]) },
    { store: "Cardmarket", url: storeLinks.cardmarket, rows: rows([["Normal", money(prices.eur, eur)], ["Foil", money(prices.eurFoil, eur)]]) },
    { store: "Cardhoarder", url: storeLinks.cardhoarder, rows: rows([["MTGO", prices.tix && Number.isFinite(Number(prices.tix)) ? `${Number(prices.tix).toFixed(2)} tix` : null]]) },
  ];
}

export const rarityLabel = (rarity: string) => RARITY_LABELS[rarity] ?? rarity;
export const finishLabel = (finish: string) => FINISH_LABELS[finish] ?? finish;

export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
