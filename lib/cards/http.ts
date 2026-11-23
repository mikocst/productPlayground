// Server-only: imported exclusively by app/api/card-scanner route handlers.
// Upstream fetch + short-lived in-memory cache shared by the card services.
// Errors carry a product-level message and status; upstream bodies are never forwarded.

const USER_AGENT = "PrototypePlayground/0.1 (card-scanner prototype)";
const TIMEOUT_MS = 8000;
const MAX_BYTES = 6 * 1024 * 1024;

export class UpstreamError extends Error {
  constructor(public status: 404 | 429 | 502 | 504, message: string) {
    super(message);
  }
}

export async function fetchJson(url: string, service: string, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new UpstreamError(timedOut ? 504 : 502, `${service} did not respond. Try again shortly.`);
  }

  // Inputs are validated before calling out, so a 400 means the query matched nothing usable.
  if (response.status === 404 || response.status === 400) throw new UpstreamError(404, `${service} has no match.`);
  if (response.status === 429) throw new UpstreamError(429, `${service} is rate limiting requests. Wait a moment and retry.`);
  if (!response.ok) throw new UpstreamError(502, `${service} is unavailable right now.`);

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new UpstreamError(502, `${service} returned more data than expected.`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new UpstreamError(502, `${service} returned more data than expected.`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new UpstreamError(502, `${service} returned an unreadable response.`);
  }
}

type Entry = { expires: number; value: Promise<unknown> };
const store = new Map<string, Entry>();
const MAX_ENTRIES = 300;

/** Caches successful results for `ttlMs` and de-duplicates in-flight requests. Failures are not cached. */
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;

  const value = load();
  store.set(key, { expires: now + ttlMs, value });
  value.catch(() => store.delete(key));

  if (store.size > MAX_ENTRIES) {
    for (const [k, entry] of store) {
      if (entry.expires <= now || store.size > MAX_ENTRIES) store.delete(k);
      if (store.size <= MAX_ENTRIES) break;
    }
  }
  return value;
}

export function errorStatus(error: unknown): { status: number; message: string } {
  if (error instanceof UpstreamError) return { status: error.status, message: error.message };
  return { status: 500, message: "Something went wrong while loading card data." };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Small runtime readers for defensive parsing of untyped upstream JSON.
export type Json = Record<string, unknown>;
export const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
export const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
