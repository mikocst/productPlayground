// The GamePlan the engine runs. Never blank: once a deck resolves, a plan is drafted from its card roles,
// and the primer form edits that draft. Known commanders get a preset (Vivi's hook is data, not code).

import { CARD_FLOW_ROLES } from "./config";
import type { BuiltDeck } from "./deck";
import type { CardData, EngineHook, GamePlan, PriorityRule } from "./types";

/** Everything in a plan except its win conditions, which live in their own list. */
export type PlanCore = Omit<GamePlan, "winConditions">;

export const VIVI_ORACLE_ID = "0452be2a-e97a-4269-a9e3-b616265ecb2e";

/** Vivi: each noncreature spell adds a counter, pings each opponent, and draws 3 per Curiosity effect. */
export const VIVI_ENGINE: EngineHook[] = [
  { on: "spellCast", filter: { noncreature: true }, effects: [{ kind: "addCounter" }, { kind: "damageEachOpponent", n: 1 }, { kind: "drawPerAmplifier", n: 3 }] },
];

export const DEFAULT_PRIORITIES: PriorityRule[] = [
  { do: "cast", role: "rock" },
  { do: "cast", role: "amplifier", when: { kind: "commanderOnBattlefield" } },
  { do: "cast", role: "drawEngine" },
  { do: "tutor", for: "missingPiece" },
  { do: "dig", prefer: CARD_FLOW_ROLES },
  { do: "deploy" },
];

export function draftPlan(deck: BuiltDeck): PlanCore {
  const roles = deck.sim.library.map((c) => c.role.kind);
  const count = (k: string) => roles.filter((r) => r === k).length;
  const lands = count("land") + count("landcycler");
  const fastMana = count("rock") + count("ritual");
  const lead: CardData | undefined = deck.commanders[0];

  if (lead?.oracleId === VIVI_ORACLE_ID) {
    return {
      targetTurn: 5,
      mulligan: { minLands: 2, maxLands: 5 },
      commander: { castWhen: "afterRamp", engine: VIVI_ENGINE, manaFromCounters: true },
      priorities: DEFAULT_PRIORITIES,
      lookFor: [],
    };
  }
  return {
    targetTurn: fastMana >= 10 ? 5 : fastMana >= 6 ? 6 : 7,
    mulligan: { minLands: lands >= 36 ? 3 : 2, maxLands: 5 },
    commander: { castWhen: lead && lead.cmc <= 2 ? "asap" : "afterRamp" },
    priorities: DEFAULT_PRIORITIES,
    lookFor: [],
  };
}

export function describeRule(rule: PriorityRule): string {
  switch (rule.do) {
    case "cast": return `Cast ${rule.role === "drawEngine" ? "draw engines" : rule.role === "amplifier" ? "commander amplifiers" : `${rule.role}s`}${rule.when?.kind === "commanderOnBattlefield" ? " once the commander is out" : ""}`;
    case "tutor": return rule.for === "missingPiece" ? "Tutor for the last missing combo piece" : `Tutor for a ${rule.for}`;
    case "dig": return "Dig: cast the cheapest card-flow spell";
    case "deploy": return "Deploy combo pieces once a line is one card away";
  }
}
