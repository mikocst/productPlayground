import type { CardIdentity, CardResponse, Combo } from "@/lib/cards/types";

export type { CardFace, CardIdentity, CardResponse, Combo, ComboCard, Printing, PrintPrices, RecognizeResponse, CombosResponse } from "@/lib/cards/types";

export type NameSource = "ocr" | "typed";

export type Recognition =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "resolving"; query: string }
  | { phase: "confirm"; card: CardIdentity; read: string; confidence: number; suggestions: string[] }
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

export type CameraStatus = "idle" | "starting" | "live" | "reading" | "denied" | "unsupported" | "error";

/** Normalized rectangle in 0..1 units of a source image. */
export type Region = { x: number; y: number; width: number; height: number };

export type OcrCandidate = { text: string; confidence: number };
