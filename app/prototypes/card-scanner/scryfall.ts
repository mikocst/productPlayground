// Client helpers for the card-scanner card routes. The browser never calls Scryfall's API directly.

import { API_BASE, FINISH_LABELS, RARITY_LABELS } from "./data";
import type { CardResponse, PrintPrices, RecognizeResponse } from "./types";

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

export function priceRows(prices: PrintPrices): { label: string; value: string }[] {
  const rows: [string, string | null, (n: number) => string][] = [
    ["USD", prices.usd, (n) => usd.format(n)],
    ["USD foil", prices.usdFoil, (n) => usd.format(n)],
    ["USD etched", prices.usdEtched, (n) => usd.format(n)],
    ["EUR", prices.eur, (n) => eur.format(n)],
    ["EUR foil", prices.eurFoil, (n) => eur.format(n)],
    ["MTGO", prices.tix, (n) => `${n.toFixed(2)} tix`],
  ];
  return rows
    .filter(([, raw]) => raw !== null && Number.isFinite(Number(raw)))
    .map(([label, raw, format]) => ({ label, value: format(Number(raw)) }));
}

export const rarityLabel = (rarity: string) => RARITY_LABELS[rarity] ?? rarity;
export const finishLabel = (finish: string) => FINISH_LABELS[finish] ?? finish;

export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
