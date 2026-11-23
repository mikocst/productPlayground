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

/** Live guidance shown over the camera while auto-scanning. */
export type ScanHint = "loading" | "searching" | "moving" | "matching" | "surfaced";

/** One artwork from the hash index and its Hamming distance (0–128) to the camera frame. */
export type ArtCandidate = { printingId: string; oracleId: string; name: string; distance: number };

export type CameraStatus = "idle" | "starting" | "live" | "denied" | "unsupported" | "error";

/** A store button: its product page and the prices to show on it. */
export type StoreOffer = { store: string; url: string | null; rows: { label: string; value: string }[] };

/** Card Kingdom prices for one printing, keyed so a stale response is never shown for another printing. */
export type CardKingdomState =
  | { printingId: string; status: "ready"; data: CardKingdomResponse }
  | { printingId: string; status: "error" };
