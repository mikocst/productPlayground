// Normalized card data shared by the card-scanner API routes and client UI.
// Upstream (Scryfall / Commander Spellbook) shapes never leave the server.

export type CardFace = {
  name: string;
  image: string | null;
};

export type PrintPrices = {
  usd: string | null;
  usdFoil: string | null;
  usdEtched: string | null;
  eur: string | null;
  eurFoil: string | null;
  tix: string | null;
};

export type PurchaseLink = { label: string; url: string };

export type Printing = {
  id: string;
  set: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  finishes: string[];
  releasedAt: string;
  lang: string;
  faces: CardFace[];
  prices: PrintPrices;
  scryfallUrl: string;
  purchaseLinks: PurchaseLink[];
};

export type CardIdentity = {
  oracleId: string;
  name: string;
  layout: string;
  typeLine: string;
};

export type CardResponse = {
  card: CardIdentity;
  printings: Printing[];
  truncated: boolean;
  fetchedAt: string;
};

export type RecognizeResponse =
  | {
      status: "matched";
      card: CardIdentity;
      matchedFrom: string;
      confidence: number;
      suggestions: string[];
    }
  | { status: "no-match"; suggestions: string[] };

export type ComboCard = {
  name: string;
  oracleId: string | null;
  image: string | null;
  zones: string[];
};

export type Combo = {
  id: string;
  url: string;
  cards: ComboCard[];
  requires: string[];
  produces: string[];
  prerequisites: string[];
  description: string;
  identity: string;
  commanderLegal: boolean;
  popularity: number | null;
  status: string;
};

export type CombosResponse = {
  combos: Combo[];
  nextOffset: number | null;
  fetchedAt: string;
};

export type ApiError = { error: string };
