// Joins parsed lines, resolved card data and saved fixes into the playable deck plus its problem flags.

import { classify, type Fix } from "./classify";
import { LIBRARY_SIZE } from "./config";
import type { CardData, DeckLine, ResolveMiss, RoleSource, SimCard, SimDeck } from "./types";

export type Issue = "notFound" | "ambiguous" | "guessed" | "unmodelled";

export type DeckEntry = {
  name: string;
  qty: number;
  data: CardData | null;
  card: SimCard | null;
  source: RoleSource | null;
  issue: Issue | null;
  suggestions: string[];
  commander: boolean;
};

export type BuiltDeck = {
  entries: DeckEntry[];
  sim: SimDeck;
  commanders: CardData[];
  /** Legendary creatures and other cards that could lead the deck, for the commander picker. */
  commanderOptions: CardData[];
  cardCount: number;
  warnings: string[];
  blocking: number;
};

const OPEN_SLOT: SimCard = { oracleId: "", name: "Open slot", cost: 0, types: [], flash: false, role: { kind: "blank" } };

export const canLead = (c: CardData) => /legendary/i.test(c.typeLine) && /creature|planeswalker/i.test(c.typeLine.split(" // ")[0]) || /can be your commander/i.test(c.oracleText);

export function buildDeck(lines: DeckLine[], resolved: (CardData | null)[], misses: ResolveMiss[], fixes: Record<string, Fix>, chosenCommanders: string[] | null): BuiltDeck {
  const played = lines.map((line, i) => ({ line, data: resolved[i] ?? null })).filter(({ line }) => line.section !== "sideboard");

  let commanderIds: Set<string>;
  if (chosenCommanders) commanderIds = new Set(chosenCommanders);
  else {
    const marked = played.filter(({ line, data }) => line.section === "commander" && data).map(({ data }) => data!.oracleId);
    const trailing = played.filter(({ line, data }) => line.trailing && data && canLead(data)).map(({ data }) => data!.oracleId);
    commanderIds = new Set(marked.length ? marked : trailing);
  }

  const byKey = new Map<string, DeckEntry>();
  for (const { line, data } of played) {
    const key = data?.oracleId ?? `?${line.name.toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) { existing.qty += line.qty; continue; }
    const commander = !!data && commanderIds.has(data.oracleId);
    const classified = data ? classify(data, fixes[data.oracleId], commander) : null;
    const miss = misses.find((m) => m.query === line.name);
    let issue: Issue | null = null;
    if (!data) issue = "notFound";
    else if (!commander && classified?.source === "guess") issue = "guessed";
    else if (!commander && classified?.source === "unmodelled") issue = "unmodelled";
    byKey.set(key, { name: data?.name ?? line.name, qty: line.qty, data, card: classified?.card ?? null, source: classified?.source ?? null, issue, suggestions: miss?.suggestions ?? [], commander });
  }
  const entries = [...byKey.values()];

  const commanders = entries.filter((e) => e.commander && e.data).map((e) => e.data!);
  const commanderCards = entries.filter((e) => e.commander && e.card).map((e) => e.card!);
  const library: SimCard[] = [];
  for (const e of entries) {
    if (!e.card) continue;
    const copies = e.commander ? e.qty - 1 : e.qty;
    for (let i = 0; i < copies; i++) library.push({ ...e.card });
  }
  const real = library.length;
  const blankSlots = entries.filter((e) => !e.card).reduce((a, e) => a + e.qty, 0);
  while (library.length < LIBRARY_SIZE) library.push({ ...OPEN_SLOT });

  const cardCount = real + commanderCards.length + blankSlots;
  const target = LIBRARY_SIZE + Math.max(1, commanderCards.length);
  const warnings: string[] = [];
  if (!commanderCards.length) warnings.push("No commander found. Mark one under a Commander header or pick one below.");
  if (cardCount !== target) {
    warnings.push(cardCount < target
      ? `${cardCount} cards; ${target - cardCount} open slot${target - cardCount > 1 ? "s are" : " is"} filled with blanks.`
      : `${cardCount} cards, more than ${target}. Every card is shuffled in, so the extras dilute draws.`);
  }

  return {
    entries,
    sim: { library, commanders: commanderCards },
    commanders,
    commanderOptions: entries.filter((e) => e.data && canLead(e.data)).map((e) => e.data!),
    cardCount,
    warnings,
    blocking: entries.filter((e) => e.issue === "notFound" || e.issue === "ambiguous").length,
  };
}
