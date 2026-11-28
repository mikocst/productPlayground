// Win conditions as data: built-in lethal damage, Commander Spellbook combos, and custom conditions.

import type { CardData, SpellbookCombo, WinCondition, WinPiece, Zone } from "./types";

export const DAMAGE_WIN: WinCondition = {
  id: "builtin:damage",
  label: "Damage",
  source: "builtin",
  state: "counts",
  pieces: [],
  manaNeeded: 0,
  requires: [{ kind: "opponentsDead" }],
};

const ZONE: Record<string, Zone> = { B: "battlefield", E: "battlefield", H: "hand", C: "command" };
const ZONE_NAMES: Record<string, string> = { G: "graveyard", L: "library", E: "exile" };

/** "{2}{R}{R}{R}" → 5. Hybrid and Phyrexian symbols count 1; X counts 0. */
export function manaValue(cost: string): number {
  return (cost.match(/\{[^}]+\}/g) ?? []).reduce((a, s) => {
    const inner = s.slice(1, -1);
    if (/^\d+$/.test(inner)) return a + Number(inner);
    if (inner === "X") return a;
    return a + 1;
  }, 0);
}

/**
 * One Spellbook variant → one WinCondition. Pieces in hand or on the battlefield cost their mana value
 * when they aren't down yet; manaNeeded is whatever Spellbook lists beyond casting the hand pieces.
 */
export function fromSpellbook(combo: SpellbookCombo, cards: Map<string, CardData>): WinCondition | null {
  const notes: string[] = [];
  const pieces: WinPiece[] = [];
  let handCost = 0;
  for (const c of combo.cards) {
    if (!c.oracleId) return null;
    const code = c.zones[0] ?? "H";
    const zone = c.mustBeCommander ? "command" : ZONE[code] ?? "hand";
    if (ZONE_NAMES[code] && code !== "E") notes.push(`${c.name} starts in the ${ZONE_NAMES[code]}; treated as in hand.`);
    if (code === "E") notes.push(`${c.name} is exiled as part of the combo (imprint); it is paid for like a permanent.`);
    if (zone === "hand") handCost += cards.get(c.oracleId)?.cmc ?? 0;
    pieces.push({ oracleIds: [c.oracleId], label: c.name, zone });
  }
  const listed = combo.manaValueNeeded || manaValue(combo.manaNeeded);
  for (const r of combo.requires) notes.push(`Also needs: ${r}.`);
  notes.push(...combo.prerequisites);
  return {
    id: `spellbook:${combo.id}`,
    label: combo.cards.map((c) => c.name.split(",")[0].split(" // ")[0]).join(" + "),
    source: "spellbook",
    state: "counts",
    pieces,
    manaNeeded: Math.max(0, listed - handCost),
    notes,
    url: combo.url,
  };
}

const signature = (w: WinCondition) => w.pieces.map((p) => [...p.oracleIds].sort().join("|")).sort().join("+");

/** A Spellbook combo whose every card is a piece of a custom condition is already covered by it. */
export function coveredBy(spellbook: WinCondition, custom: WinCondition[]): WinCondition | undefined {
  const ids = spellbook.pieces.flatMap((p) => p.oracleIds);
  return custom.find((c) => {
    const all = new Set(c.pieces.flatMap((p) => p.oracleIds));
    return ids.every((id) => all.has(id)) || signature(c) === signature(spellbook);
  });
}

/** Builtin, then custom, then Spellbook; states from the user's choices. Covered Spellbook combos start ignored. */
export function mergeWins(custom: WinCondition[], spellbook: WinCondition[], states: Record<string, WinCondition["state"]>): WinCondition[] {
  const merged = [DAMAGE_WIN, ...custom, ...spellbook.map((s) => (coveredBy(s, custom) ? { ...s, state: "ignored" as const } : s))];
  return merged.map((w) => (states[w.id] ? { ...w, state: states[w.id] } : w));
}

/** The Vivi sim's checkWin() branches, re-expressed as data. Needs the demo deck's oracle ids by name. */
export function viviWins(idOf: (name: string) => string | undefined): WinCondition[] {
  const piece = (names: string[], zone: Zone, label?: string): WinPiece | null => {
    const ids = names.map(idOf).filter((x): x is string => !!x);
    return ids.length ? { oracleIds: ids, label: label ?? names.join(" or "), zone } : null;
  };
  const untapper = piece(["Pestermite", "Deceiver Exarch", "Zealous Conscripts"], "battlefield", "an untapper");
  const rock = piece(["Arcane Signet", "Fellwar Stone", "Izzet Signet", "Mind Stone", "Talisman of Creativity"], "battlefield", "another mana rock");
  const defs: [string, string, (WinPiece | null)[], number, WinCondition["requires"]?][] = [
    ["custom:scepter", "Scepter + Reversal", [piece(["Isochron Scepter"], "battlefield"), piece(["Dramatic Reversal"], "battlefield")], 0, [{ kind: "nonlandMana", min: 3 }]],
    ["custom:hullbreaker", "Hullbreaker loop", [piece(["Hullbreaker Horror"], "battlefield"), piece(["Sol Ring"], "battlefield"), rock], 2, [{ kind: "commanderOnBattlefield" }]],
    ["custom:kiki", "Kiki-Jiki", [piece(["Kiki-Jiki, Mirror Breaker"], "battlefield", "Kiki-Jiki"), untapper], 0],
    ["custom:twin", "Splinter Twin", [piece(["Splinter Twin"], "hand"), untapper], 0],
    ["custom:dualcaster", "Dualcaster", [piece(["Dualcaster Mage"], "hand"), piece(["Twinflame", "Heat Shimmer"], "hand")], 0],
    ["custom:grapeshot", "Grapeshot storm", [piece(["Grapeshot"], "hand")], 0, [{ kind: "stormLethal" }]],
  ];
  return defs
    .filter(([, , pieces]) => pieces.every((p) => p))
    .map(([id, label, pieces, manaNeeded, requires]) => ({
      id, label, source: "custom" as const, state: "counts" as const, pieces: pieces as WinPiece[], manaNeeded, ...(requires ? { requires } : {}),
    }));
}
