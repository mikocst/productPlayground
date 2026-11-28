import type { CardIdentity, CardKingdomResponse, CardResponse, Combo } from "@/lib/cards/types";

export type { CardFace, CardIdentity, CardKingdomOffer, CardKingdomResponse, CardResponse, Combo, ComboCard, Printing, PrintPrices, RecognizeResponse, CombosResponse } from "@/lib/cards/types";

export type Recognition =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "resolving"; query: string }
  | { phase: "confirm"; card: CardIdentity; printId: string | null; read: string; suggestions: string[] }
  | { phase: "no-match"; read: string; suggestions: string[] }
  | { phase: "error"; message: string };

export type CardState =
  | { status: "empty" }
  | { status: "loading"; name?: string }
  | { status: "ready"; data: CardResponse }
  | { status: "error"; message: string; oracleId: string };

export type ComboState = {
  oracleId: string | null;
  items: Combo[];
  nextOffset: number | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  expanded: boolean;
};

/** Live guidance shown over the camera while auto-scanning. "moving" is v1 only, "glare" v2 only. */
export type ScanHint = "loading" | "searching" | "moving" | "matching" | "glare" | "surfaced";

/** Which quad produced a v2 frame match. */
export type QuadSource = "tracked" | "outline" | "guide" | "image" | "none";

/** The best card in one v2 frame, with its most likely printing. Distances are out of 256 bits. */
export type FrameMatch = {
  nameIndex: number;
  oracleId: string;
  name: string;
  distance: number;
  printingId: string;
  set: string;
  collector: string;
  /** Only one printing of the card looks like this. */
  printingCertain: boolean;
};

/** What the v2 worker found in one frame. Quad corners are in the posted frame's pixels. */
export type FrameAnalysis = {
  hasOutline: boolean;
  outlines: number;
  quad: readonly number[] | null;
  source: QuadSource;
  best: FrameMatch | null;
  /** The closest *different* card. */
  runnerUp: { name: string; distance: number } | null;
  confident: boolean;
  ms: number;
};

/** A recognized card as handed to the page: the printing to open and its distance (v1: 0–128, v2: 0–256). */
export type ArtCandidate = { printingId: string; oracleId: string; name: string; distance: number };

export type CameraStatus = "idle" | "starting" | "live" | "denied" | "unsupported" | "error";

/** A store button: its product page and the prices to show on it. */
export type StoreOffer = { store: string; url: string | null; rows: { label: string; value: string }[] };

/** Card Kingdom prices for one printing, keyed so a stale response is never shown for another printing. */
export type CardKingdomState =
  | { printingId: string; status: "ready"; data: CardKingdomResponse }
  | { printingId: string; status: "error" };
