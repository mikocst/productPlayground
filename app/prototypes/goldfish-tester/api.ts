// Client fetchers for the goldfish-tester API routes. Errors surface the route's product message.

import type { CombosResponse, DeckLine, ImportResult, ResolveResponse } from "./types";

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Handled below.
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Something went wrong.";
    throw new Error(message);
  }
  if (!body || typeof body !== "object") throw new Error("The server sent an unreadable response.");
  return body as T;
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

export function resolveDeck(lines: DeckLine[], signal?: AbortSignal) {
  return request<ResolveResponse>("/api/goldfish-tester/resolve", post({ lines: lines.map(({ name, set, collectorNumber }) => ({ name, set, collectorNumber })) }, signal));
}

export function findCombos(commanders: string[], main: string[], signal?: AbortSignal) {
  return request<CombosResponse>("/api/goldfish-tester/combos", post({ commanders, main }, signal));
}

export function importDeckUrl(url: string, signal?: AbortSignal) {
  return request<ImportResult>(`/api/goldfish-tester/import?url=${encodeURIComponent(url)}`, { signal });
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
