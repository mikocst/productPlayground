// The whole setup in the URL hash, so a shared link reproduces the same histogram.
// JSON → deflate-raw (the browser's CompressionStream) → base64url. Decoding validates every field.

import type { Fix } from "./classify";
import { GAME_OPTIONS, TURN_CAPS } from "./config";
import type { PlanCore } from "./plan";
import type { RunSettings, WinCondition } from "./types";

export type SharedSetup = {
  v: 1;
  deck: string;
  commanders: string[] | null;
  fixes: Record<string, Fix>;
  states: Record<string, WinCondition["state"]>;
  custom: WinCondition[];
  plan: PlanCore | null;
  settings: RunSettings;
  spellbook: boolean;
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export async function encodeSetup(setup: SharedSetup): Promise<string> {
  return toBase64Url(await pipe(new TextEncoder().encode(JSON.stringify(setup)), new CompressionStream("deflate-raw")));
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export async function decodeSetup(hash: string): Promise<SharedSetup | null> {
  const text = hash.replace(/^#/, "").replace(/^s=/, "");
  if (!text || text.length > 200_000) return null;
  try {
    const json = new TextDecoder().decode(await pipe(fromBase64Url(text), new DecompressionStream("deflate-raw")));
    const raw: unknown = JSON.parse(json);
    if (!isObj(raw) || raw.v !== 1 || typeof raw.deck !== "string" || !isObj(raw.settings)) return null;
    const s = raw.settings;
    const settings: RunSettings = {
      games: GAME_OPTIONS.includes(s.games as never) ? (s.games as number) : 5000,
      seed: typeof s.seed === "number" && Number.isFinite(s.seed) ? Math.abs(Math.floor(s.seed)) : 1126,
      onPlay: s.onPlay !== false,
      turnCap: TURN_CAPS.includes(s.turnCap as never) ? (s.turnCap as number) : 10,
    };
    return {
      v: 1,
      deck: raw.deck.slice(0, 20000),
      commanders: Array.isArray(raw.commanders) ? raw.commanders.filter((x): x is string => typeof x === "string") : null,
      fixes: isObj(raw.fixes) ? (raw.fixes as Record<string, Fix>) : {},
      states: isObj(raw.states) ? (raw.states as SharedSetup["states"]) : {},
      custom: Array.isArray(raw.custom) ? (raw.custom as WinCondition[]).filter((w) => isObj(w) && typeof w.id === "string" && Array.isArray(w.pieces)) : [],
      plan: isObj(raw.plan) && Array.isArray(raw.plan.priorities) && isObj(raw.plan.mulligan) && isObj(raw.plan.commander) ? (raw.plan as PlanCore) : null,
      settings,
      spellbook: raw.spellbook === true,
    };
  } catch {
    return null;
  }
}
