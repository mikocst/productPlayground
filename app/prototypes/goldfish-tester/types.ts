// Shared types for the goldfish tester. Everything here is plain data so it can cross the worker
// boundary, live in the URL hash, and be compared in tests.

// ── Import ────────────────────────────────────────────────────────────────────────────────────────

export type Section = "commander" | "deck" | "sideboard";

/** One parsed decklist line. Every import route (paste, Archidekt) produces this shape. */
export type DeckLine = {
  qty: number;
  name: string;
  set?: string;
  collectorNumber?: string;
  section: Section;
  /** Lines after the last blank line of a header-less list: a commander candidate. */
  trailing?: boolean;
};

export type ImportResult = { lines: DeckLine[]; primer?: string; title?: string };

// ── Card data (normalized Scryfall fields, from /api/goldfish-tester/resolve) ─────────────────────

export type CardData = {
  oracleId: string;
  name: string;
  cmc: number;
  manaCost: string;
  typeLine: string;
  /** Back face type line for modal double-faced cards ("Land" on Sink into Stupor). */
  backTypeLine?: string;
  oracleText: string;
  producedMana: string[];
  keywords: string[];
};

export type ResolveMiss = { query: string; suggestions: string[] };
export type ResolveResponse = { cards: (CardData | null)[]; misses: ResolveMiss[] };

// ── Commander Spellbook (normalized find-my-combos variants, from /api/goldfish-tester/combos) ──────

export type SpellbookCombo = {
  id: string;
  url: string;
  cards: { name: string; oracleId: string | null; zones: string[]; mustBeCommander: boolean }[];
  manaNeeded: string;
  manaValueNeeded: number;
  requires: string[];
  prerequisites: string[];
  produces: string[];
};

export type CombosResponse = { included: SpellbookCombo[]; almostIncluded: number };

// ── Roles: how the pilot plays a card ─────────────────────────────────────────────────────────────

export type CardType = "land" | "artifact" | "creature" | "enchantment" | "instant" | "sorcery" | "planeswalker" | "battle";

/** What a tutor may fetch. Empty means any card. */
export type TutorFilter = { types?: CardType[]; mv?: number };

export type Role =
  | { kind: "land"; mana: number }
  | { kind: "landcycler" }
  | { kind: "rock"; mana: number }
  | { kind: "ritual"; adds: number; impulse?: number }
  | { kind: "cantrip"; look: number; take: number }
  | { kind: "wheel" }
  | { kind: "frantic" }
  | { kind: "gush" }
  | { kind: "drawEngine"; draws: number; turns?: number; growing?: boolean }
  | { kind: "amplifier" }
  | { kind: "tutor"; find: TutorFilter; toTop?: boolean; discardRandom?: boolean }
  | { kind: "burn"; damage: number }
  | { kind: "blank" };

export type RoleKind = Role["kind"];

/** Where a card's role came from. Guesses and blanks raise problem flags. */
export type RoleSource = "curated" | "auto" | "guess" | "fix" | "interaction" | "unmodelled";

/** A card ready to play: identity, cost and role. One per copy in the library. */
export type SimCard = {
  oracleId: string;
  name: string;
  cost: number;
  types: CardType[];
  flash: boolean;
  role: Role;
};

// ── Win conditions ────────────────────────────────────────────────────────────────────────────────

export type Zone = "hand" | "battlefield" | "command";

export type Condition =
  | { kind: "commanderOnBattlefield" }
  /** Mana from nonland permanents (rocks, plus 1 for a commander that taps for mana). */
  | { kind: "nonlandMana"; min: number }
  /** Storm copies plus the spell itself cover every opponent's remaining life. */
  | { kind: "stormLethal" }
  | { kind: "opponentsDead" }
  | { kind: "minLands"; n: number };

export type WinPiece = {
  /** Any of these cards fills the piece (Kiki-Jiki + Pestermite *or* Deceiver Exarch). */
  oracleIds: string[];
  label: string;
  zone: Zone;
};

export type WinCondition = {
  id: string;
  label: string;
  source: "spellbook" | "custom" | "builtin";
  state: "counts" | "ignored";
  pieces: WinPiece[];
  /** Mana beyond casting the pieces themselves (activations, the Twinflame copy). */
  manaNeeded: number;
  requires?: Condition[];
  /** Spellbook prerequisites the engine can't read, shown for review. */
  notes?: string[];
  url?: string;
};

// ── Game plan (compiled from the primer form) ─────────────────────────────────────────────────────

export type Effect =
  | { kind: "addCounter" }
  | { kind: "damageEachOpponent"; n: number }
  | { kind: "draw"; n: number }
  | { kind: "drawPerAmplifier"; n: number }
  | { kind: "addMana"; n: number };

export type EngineHook = {
  on: "spellCast" | "landPlayed" | "upkeep" | "creatureEnters";
  filter?: { noncreature?: boolean; type?: CardType };
  effects: Effect[];
};

export type PriorityRule =
  | { do: "cast"; role: RoleKind; when?: Condition }
  | { do: "tutor"; for: "missingPiece" | RoleKind }
  | { do: "dig"; prefer: RoleKind[] }
  /** Put battlefield pieces down once their win condition is at most one card away. */
  | { do: "deploy" };

export type GamePlan = {
  targetTurn: number;
  mulligan: { minLands: number; maxLands: number; mustSee?: RoleKind[] };
  commander: {
    castWhen: "asap" | "afterRamp";
    engine?: EngineHook[];
    /** Taps for mana equal to its counters (Vivi Ornitier). */
    manaFromCounters?: boolean;
  };
  priorities: PriorityRule[];
  /** What card selection and fallback tutors look for, best first. */
  lookFor: RoleKind[];
  winConditions: WinCondition[];
};

// ── Simulation I/O ────────────────────────────────────────────────────────────────────────────────

export type RunSettings = { games: number; seed: number; onPlay: boolean; turnCap: number };

export type SimDeck = { library: SimCard[]; commanders: SimCard[] };

export type LogLine = { text: string; tone?: "turn" | "assembled" | "executed" | "commander" };

export type GameResult = {
  executed: number | null;
  assembled: number | null;
  line: string | null;
  commanderTurn: number | null;
  mulligans: number;
  log: LogLine[] | null;
};

export type RunSummary = {
  games: number;
  turnCap: number;
  onPlay: boolean;
  /** byTurn[t - 1] = games executed on turn t; the last slot is "no win by the cap". */
  executedByTurn: number[];
  /** Games that assembled on turn t but executed later (or never): the ghost segments. */
  ghostByTurn: number[];
  lines: { label: string; count: number }[];
  medianExecuted: number | null;
  wonByTarget: number;
  /** Mean (executed − assembled) over games that did both. */
  meanGap: number | null;
  meanCommanderTurn: number | null;
  mulliganShare: number;
};

export type WorkerRequest =
  | { type: "run"; id: number; deck: SimDeck; plan: GamePlan; settings: RunSettings }
  | { type: "sample"; id: number; deck: SimDeck; plan: GamePlan; settings: RunSettings; offset: number };

export type WorkerResponse =
  | { type: "run"; id: number; summary: RunSummary }
  | { type: "sample"; id: number; game: GameResult }
  | { type: "error"; id: number; message: string };
