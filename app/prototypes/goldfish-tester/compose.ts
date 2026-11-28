// Pure: everything the user has set up → the deck and plan the engine runs.

import type { Fix } from "./classify";
import { buildDeck, type BuiltDeck } from "./deck";
import demoCards from "./demoCards.json";
import { DEMO_DECK } from "./demoDeck";
import { lineKey, parseDecklist } from "./parse";
import { draftPlan, type PlanCore } from "./plan";
import type { CardData, DeckLine, GamePlan, ResolveMiss, SpellbookCombo, WinCondition } from "./types";
import { fromSpellbook, mergeWins, viviWins } from "./wins";

export type Resolved = { lines: DeckLine[]; cards: (CardData | null)[]; misses: ResolveMiss[] };

export type Setup = {
  resolved: Resolved;
  fixes: Record<string, Fix>;
  commanders: string[] | null;
  combos: SpellbookCombo[];
  custom: WinCondition[];
  states: Record<string, WinCondition["state"]>;
  plan: PlanCore | null;
};

const DEMO_CARDS = demoCards as Record<string, CardData>;
const normalize = (text: string) => text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
const DEMO_KEY = normalize(DEMO_DECK);

export const isDemoText = (text: string) => normalize(text) === DEMO_KEY;

/** The demo resolves from baked data, so it runs before (and without) any lookup. */
export function resolveDemo(): Resolved {
  const lines = parseDecklist(DEMO_DECK);
  return { lines, cards: lines.map((l) => DEMO_CARDS[lineKey(l)] ?? null), misses: [] };
}

export function demoCustomWins(): WinCondition[] {
  const ids = new Map(Object.values(DEMO_CARDS).map((c) => [c.name, c.oracleId]));
  return viviWins((name) => ids.get(name));
}

export type Composed = { deck: BuiltDeck; plan: GamePlan; wins: WinCondition[]; drafted: PlanCore };

export function compose(s: Setup): Composed {
  const deck = buildDeck(s.resolved.lines, s.resolved.cards, s.resolved.misses, s.fixes, s.commanders);
  const byId = new Map(s.resolved.cards.filter((c): c is CardData => !!c).map((c) => [c.oracleId, c]));
  const spellbook = s.combos.map((c) => fromSpellbook(c, byId)).filter((w): w is WinCondition => !!w);
  const wins = mergeWins(s.custom, spellbook, s.states);
  const drafted = draftPlan(deck);
  return { deck, wins, drafted, plan: { ...(s.plan ?? drafted), winConditions: wins } };
}
