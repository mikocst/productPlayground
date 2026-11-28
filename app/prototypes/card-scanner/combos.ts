// Client helpers for the combos route plus pure display formatting.

import { API_BASE, COLOR_NAMES } from "./data";
import { readJson } from "./scryfall";
import type { CombosResponse } from "./types";

export async function fetchCombos(oracleId: string, offset: number, limit: number, signal?: AbortSignal): Promise<CombosResponse> {
  const params = new URLSearchParams({ oracleId, offset: String(offset), limit: String(limit) });
  const response = await fetch(`${API_BASE}/combos?${params}`, { signal });
  return readJson<CombosResponse>(response);
}

export function identityLabel(identity: string): string {
  return identity
    .split("")
    .map((letter) => COLOR_NAMES[letter] ?? letter)
    .join(" · ");
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function popularityLabel(popularity: number | null): string | null {
  return popularity === null ? null : `${compact.format(popularity)} decks`;
}
