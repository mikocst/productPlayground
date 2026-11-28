// localStorage under prototype-namespaced keys. Read only after mount; every access is guarded.

import type { Fix } from "./classify";
import { FIXES_KEY, STORAGE_KEY } from "./config";

export function loadFixes(): Record<string, Fix> {
  try {
    const raw = JSON.parse(localStorage.getItem(FIXES_KEY) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function saveFixes(fixes: Record<string, Fix>) {
  try {
    localStorage.setItem(FIXES_KEY, JSON.stringify(fixes));
  } catch {
    // Storage full or blocked: fixes still apply for this visit.
  }
}

export function loadLastDeck(): string | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return raw && typeof raw.deck === "string" ? raw.deck : null;
  } catch {
    return null;
  }
}

export function saveLastDeck(deck: string | null) {
  try {
    if (deck === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ deck }));
  } catch {
    // Ignore: remembering the last deck is a convenience.
  }
}
