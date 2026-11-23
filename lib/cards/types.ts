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

/** Product pages on the stores whose prices Scryfall reports (TCGplayer: USD, Cardmarket: EUR, Cardhoarder: MTGO tix). */
export type StoreLinks = { tcgplayer: string | null; cardmarket: string | null; cardhoarder: string | null };

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
  storeLinks: StoreLinks;
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
      /** True when the match came from a prefix-autocomplete guess rather than a direct lookup. */
      guess: boolean;
      confidence: number;
      suggestions: string[];
    }
  | { status: "no-match"; suggestions: string[] };

export type ComboCard = {
  name: string;
  oracleId: string | null;
  image: string | null;
  /** Full-size front image for the card preview modal. */
  largeImage: string | null;
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

/** Card Kingdom retail offers for one printing, from Card Kingdom's public price list. */
export type CardKingdomOffer = { price: string; url: string; inStock: boolean };
export type CardKingdomResponse = { nonfoil: CardKingdomOffer | null; foil: CardKingdomOffer | null; updatedAt: string | null };

export type ApiError = { error: string };
