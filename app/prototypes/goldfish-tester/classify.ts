// Turns resolved card data into a playable SimCard. Three layers, last one wins:
// automatic (type line, produced mana, oracle-text guesses) → curated registry → the user's saved fix.

import { curated } from "./registry";
import type { CardData, CardType, Role, RoleSource, SimCard, TutorFilter } from "./types";

export type Classified = { card: SimCard; source: RoleSource };
export type Fix = { role: Role; cost?: number };

const TYPES: CardType[] = ["land", "artifact", "creature", "enchantment", "instant", "sorcery", "planeswalker", "battle"];
const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (w: string) => WORDS[w] ?? (Number(w) || 0);

export function typesOf(typeLine: string): CardType[] {
  const front = typeLine.split(" // ")[0].toLowerCase();
  return TYPES.filter((t) => front.includes(t));
}

/** Mana symbols in the first "Add …" phrase, less any generic activation cost ("{1}, {T}: Add {U}{R}" nets 1). */
function addedMana(text: string): number {
  const m = text.match(/add ((?:\{[^}]+\})+)/i);
  if (!m) return 1;
  let n = (m[1].match(/\{[^}]+\}/g) ?? []).length;
  const activation = text.match(/\{(\d+)\}, \{t\}: add/i);
  if (activation) n -= Number(activation[1]);
  return Math.max(1, n);
}

function tutorFilter(text: string): TutorFilter {
  if (/instant or sorcery card/.test(text)) return { types: ["instant", "sorcery"] };
  for (const t of ["artifact", "creature", "enchantment", "instant", "sorcery", "planeswalker"] as const) {
    if (new RegExp(`for an? ${t} card`).test(text)) return { types: [t] };
  }
  return {};
}

const INTERACTION = /counter target|destroy target|exile target|return target (?:nonland )?(?:permanent|creature|artifact|spell)|destroy all|exile all|return all/;

function guess(card: CardData, types: CardType[], isCommander: boolean): { role: Role; source: RoleSource } {
  const text = card.oracleText.toLowerCase();
  const spell = types.includes("instant") || types.includes("sorcery");
  const creature = types.includes("creature");
  if (types.includes("land")) return { role: { kind: "land", mana: /add \{c\}\{c\}/.test(text) ? 2 : 1 }, source: "auto" };
  if (card.backTypeLine?.toLowerCase().includes("land")) return { role: { kind: "land", mana: 1 }, source: "auto" };
  if (card.keywords.some((k) => /^(\w+)cycling$/i.test(k) && k.toLowerCase() !== "cycling")) return { role: { kind: "landcycler" }, source: "guess" };
  if (types.includes("artifact") && !creature && card.producedMana.length) {
    return { role: { kind: "rock", mana: addedMana(card.oracleText) }, source: /^\{t\}: add/m.test(text) ? "auto" : "guess" };
  }
  if (creature && !isCommander && card.producedMana.length && /\{t\}: add/.test(text)) return { role: { kind: "rock", mana: addedMana(card.oracleText) }, source: "guess" };
  if (spell && /\badd (?:\{[wubrgc]\}){2,}/.test(text)) return { role: { kind: "ritual", adds: addedMana(card.oracleText) }, source: "guess" };
  if (/search your library for/.test(text) && !/land card/.test(text)) {
    return { role: { kind: "tutor", find: tutorFilter(text), ...(/on top/.test(text) ? { toTop: true } : {}) }, source: "guess" };
  }
  if (/each player discards their hand/.test(text) && /draw/.test(text)) return { role: { kind: "wheel" }, source: "guess" };
  if (!spell && /(at the beginning of your upkeep|whenever an opponent casts|at the beginning of your draw step)/.test(text) && /draws? (a|one|two) cards?/.test(text)) {
    return { role: { kind: "drawEngine", draws: 1 }, source: "guess" };
  }
  if (spell && INTERACTION.test(text)) return { role: { kind: "blank" }, source: "interaction" };
  if (spell) {
    const look = text.match(/look at the top (\w+) cards?/);
    const take = text.match(/put (\w+) of them into your hand/);
    const draw = text.match(/draws? (a|one|two|three|four|\d+) cards?/);
    const scry = text.match(/scry (\d+)/);
    if (look) return { role: { kind: "cantrip", look: num(look[1]), take: take ? num(take[1]) : 1 }, source: "guess" };
    if (draw) {
      const n = num(draw[1]);
      return { role: { kind: "cantrip", look: n + (scry ? Number(scry[1]) : 0), take: n }, source: "guess" };
    }
    const burn = text.match(/deals (\d+) damage to (any target|each opponent|target player|target opponent)/);
    if (burn) return { role: { kind: "burn", damage: Number(burn[1]) }, source: "guess" };
  }
  if (INTERACTION.test(text)) return { role: { kind: "blank" }, source: "interaction" };
  return { role: { kind: "blank" }, source: "unmodelled" };
}

export function classify(card: CardData, fix: Fix | undefined, isCommander: boolean): Classified {
  const types = typesOf(card.typeLine);
  const base = { oracleId: card.oracleId, name: card.name, types, flash: card.keywords.includes("Flash") };
  if (fix) return { card: { ...base, role: fix.role, cost: fix.cost ?? card.cmc }, source: "fix" };
  const c = curated(card.name) ?? curated(card.name.split(" // ")[0]);
  if (c) return { card: { ...base, role: c.role, cost: c.cost ?? card.cmc }, source: c.interaction ? "interaction" : "curated" };
  const g = guess(card, types, isCommander);
  return { card: { ...base, role: g.role, cost: card.cmc }, source: g.source };
}

export function describeRole(role: Role): string {
  switch (role.kind) {
    case "land": return role.mana > 1 ? `Land (${role.mana} mana)` : "Land";
    case "landcycler": return "Cycles for a land";
    case "rock": return `Mana rock (+${role.mana})`;
    case "ritual": return `Ritual (+${role.adds}${role.impulse ? `, exiles ${role.impulse}` : ""})`;
    case "cantrip": return `Look at ${role.look}, keep ${role.take}`;
    case "wheel": return "Wheel";
    case "frantic": return "Draw 2, discard 2, untap 3 lands";
    case "gush": return "Return 2 Islands, draw 2";
    case "drawEngine": return role.growing ? "Draws more each turn" : `Draws ${role.draws} a turn${role.turns ? ` for ${role.turns} turns` : ""}`;
    case "amplifier": return "Draws 3 on commander triggers";
    case "tutor": {
      const what = role.find.types?.length ? role.find.types.join(" or ") : role.find.mv !== undefined ? `mana value ${role.find.mv}` : "any card";
      return `Tutor (${what}${role.toTop ? ", to top" : ""})`;
    }
    case "burn": return `Burn (${role.damage})`;
    case "blank": return "Blank";
  }
}
