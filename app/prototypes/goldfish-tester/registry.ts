// Curated roles: hand-written behaviour for cards the oracle-text heuristics can't model well.
// This is the Vivi sim's DB table, keyed by oracle name (reflavored printings resolve to it first).
// `cost` overrides mana value where the real cost differs (Gush's alternate cost, transmute, delve).

import type { Role } from "./types";

export type Curated = { role: Role; cost?: number; interaction?: boolean };

const R: Record<string, Curated> = {};
const add = (names: string[], entry: Curated) => names.forEach((n) => { R[n.toLowerCase()] = entry; });

add(["Ancient Tomb"], { role: { kind: "land", mana: 2 } });
add(["Lórien Revealed"], { role: { kind: "landcycler" } });
add(["Sol Ring"], { role: { kind: "rock", mana: 2 } });
add(["Mana Crypt"], { role: { kind: "rock", mana: 2 } });
add(["Mana Vault"], { role: { kind: "rock", mana: 3 } });
add(["Arcane Signet", "Fellwar Stone", "Izzet Signet", "Mind Stone", "Talisman of Creativity", "Coldsteel Heart", "Thought Vessel"], { role: { kind: "rock", mana: 1 } });

const cantrip = (name: string, cost: number, look: number, take: number) => add([name], { role: { kind: "cantrip", look, take }, cost });
cantrip("Brainstorm", 1, 3, 1); cantrip("Consider", 1, 2, 1); cantrip("Opt", 1, 2, 1); cantrip("Ponder", 1, 4, 1);
cantrip("Preordain", 1, 3, 1); cantrip("Serum Visions", 1, 3, 1); cantrip("Sleight of Hand", 1, 2, 1); cantrip("Impulse", 2, 4, 1);
cantrip("Gitaxian Probe", 0, 1, 1); cantrip("Mishra's Bauble", 0, 1, 1); cantrip("Stock Up", 3, 5, 2); cantrip("Expressive Iteration", 2, 3, 2);
cantrip("Fact or Fiction", 4, 5, 2); cantrip("Light Up the Stage", 3, 2, 2); cantrip("Archmage's Charm", 3, 2, 2);
cantrip("Dig Through Time", 3, 7, 2); cantrip("Treasure Cruise", 3, 3, 3); cantrip("Thrill of Possibility", 2, 2, 2);

add(["Frantic Search"], { role: { kind: "frantic" }, cost: 3 });
add(["Gush"], { role: { kind: "gush" }, cost: 0 });
add(["Windfall"], { role: { kind: "wheel" }, cost: 3 });
add(["Jeska's Will"], { role: { kind: "ritual", adds: 5, impulse: 3 }, cost: 3 });
add(["Rhystic Study"], { role: { kind: "drawEngine", draws: 1 }, cost: 3 });
add(["Mystic Remora"], { role: { kind: "drawEngine", draws: 1, turns: 2 }, cost: 1 });
add(["The One Ring"], { role: { kind: "drawEngine", draws: 1, growing: true }, cost: 4 });
add(["Curiosity", "Ophidian Eye", "Tandem Lookout"], { role: { kind: "amplifier" } });

add(["Mystical Tutor"], { role: { kind: "tutor", find: { types: ["instant", "sorcery"] }, toTop: true } });
add(["Merchant Scroll"], { role: { kind: "tutor", find: { types: ["instant"] } } });
add(["Gamble"], { role: { kind: "tutor", find: {}, discardRandom: true } });
add(["Imperial Recruiter"], { role: { kind: "tutor", find: { types: ["creature"] } } });
add(["Muddle the Mixture"], { role: { kind: "tutor", find: { mv: 2 } }, cost: 3 });
add(["Drift of Phantasms"], { role: { kind: "tutor", find: { mv: 3 } }, cost: 3 });
add(["Solve the Equation"], { role: { kind: "tutor", find: { types: ["instant", "sorcery"] } } });
add(["Personal Tutor"], { role: { kind: "tutor", find: { types: ["sorcery"] }, toTop: true } });
add(["Fabricate"], { role: { kind: "tutor", find: { types: ["artifact"] } } });
add(["Lightning Bolt"], { role: { kind: "burn", damage: 3 } });

// Win-condition pieces: no role of their own, played through win conditions and the deploy rule.
add(["Isochron Scepter", "Dramatic Reversal", "Hullbreaker Horror", "Kiki-Jiki, Mirror Breaker", "Pestermite", "Deceiver Exarch",
  "Zealous Conscripts", "Splinter Twin", "Dualcaster Mage", "Twinflame", "Heat Shimmer", "Aetherflux Reservoir", "Grapeshot",
  "Brain Freeze", "Thassa's Oracle", "Faerie Mastermind", "Laboratory Maniac"], { role: { kind: "blank" } });

// Interaction: dead cards in a goldfish, which is the point of measuring them.
add(["Abrade", "An Offer You Can't Refuse", "Arcane Denial", "Chaos Warp", "Counterspell", "Cyclonic Rift", "Fierce Guardianship",
  "Flusterstorm", "Force of Negation", "Force of Will", "Into the Roil", "Mental Misstep", "Pact of Negation", "Pyroblast", "Snap",
  "Spell Pierce", "Swan Song", "Mana Drain", "Deflecting Swat", "Dispel", "Red Elemental Blast", "Cryptic Command", "Dovin's Veto",
  "Chromatic Lantern"], { role: { kind: "blank" }, interaction: true });

export function curated(oracleName: string): Curated | undefined {
  return R[oracleName.toLowerCase()];
}
