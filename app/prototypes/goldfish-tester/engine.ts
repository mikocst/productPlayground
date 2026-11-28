// The goldfish engine: one seeded game, no DOM, no opponent interaction. It generalises the Vivi sim:
// cards act through their Role, the commander through EngineHooks, and wins through WinCondition data.
// Kept from the Vivi sim: the mulligan loop, the card-selection score(), and the pilot's action order.

import { MAX_MULLIGANS, OPPONENTS, STARTING_LIFE, STEP_CAP } from "./config";
import type { Condition, Effect, EngineHook, GamePlan, GameResult, LogLine, PriorityRule, RoleKind, SimCard, SimDeck, TutorFilter, WinCondition } from "./types";

type Rule = PriorityRule | { do: "commander" };

type Fill = { card: SimCard; from: "battlefield" | "hand" | "command"; cost: number };
type Evaluation = { missing: number; fills: Fill[]; missingIds: string[][] };
type UpkeepEngine = { card: SimCard; draws: number; turnsLeft: number | null; growing: boolean; drawn: number; since: number };

const ISLAND: SimCard = { oracleId: "", name: "Island", cost: 0, types: ["land"], flash: false, role: { kind: "land", mana: 1 } };

const isPermanent = (c: SimCard) => c.types.some((t) => t !== "instant" && t !== "sorcery");
const landish = (c: SimCard) => c.role.kind === "land" || c.role.kind === "landcycler";

export function matchesFilter(c: SimCard, filter: TutorFilter): boolean {
  if (filter.types?.length && !filter.types.some((t) => c.types.includes(t))) return false;
  if (filter.mv !== undefined && c.cost !== filter.mv) return false;
  return true;
}

/** Inserts the commander rule where the plan says it is cast. */
export function pilotRules(plan: GamePlan, hasCommander: boolean): Rule[] {
  const rules: Rule[] = [...plan.priorities];
  if (!hasCommander) return rules;
  let at = 0;
  if (plan.commander.castWhen === "afterRamp") {
    rules.forEach((r, i) => { if (r.do === "cast" && r.role === "rock") at = i + 1; });
  }
  rules.splice(at, 0, { do: "commander" });
  return rules;
}

export function simulate(deck: SimDeck, plan: GamePlan, rng: () => number, onPlay: boolean, turnCap: number, logOn: boolean): GameResult {
  const L: LogLine[] | null = logOn ? [] : null;
  const say = (text: string, tone?: LogLine["tone"]) => { if (L) L.push(tone ? { text, tone } : { text }); };
  const shuffle = <T,>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const counting = plan.winConditions.filter((w) => w.state === "counts");
  const rules = pilotRules(plan, deck.commanders.length > 0);
  const hooks = plan.commander.engine ?? [];
  const hookDamage = hooks.filter((h) => h.on === "spellCast").flatMap((h) => h.effects).reduce((a, e) => a + (e.kind === "damageEachOpponent" ? e.n : 0), 0);

  let lib: SimCard[] = [];
  let hand: SimCard[] = [];
  const battlefield: SimCard[] = [];
  const command = [...deck.commanders];
  const engines: UpkeepEngine[] = [];
  let lands = 0, landMana = 0, mana = 0, storm = 0, turn = 1, mulligans = 0;
  let commanderOn = false, counters = 0, counterUsed = false, commanderTurn: number | null = null;
  let opp = Array.from({ length: OPPONENTS }, () => STARTING_LIFE);
  let temp: SimCard[] = [];
  let firstAssembled: number | null = null;
  const assembledSeen = new Set<string>();

  const primary = deck.commanders[0] ?? null;
  const counterMana = () => (commanderOn && plan.commander.manaFromCounters && !counterUsed ? counters : 0);
  const avail = () => mana + counterMana();
  const pay = (cost: number) => {
    if (mana < cost && counterMana() > 0) {
      mana += counters;
      counterUsed = true;
      say(`${primary?.name ?? "Commander"} taps for ${counters} mana`);
    }
    mana -= cost;
  };
  const drawN = (n: number) => { for (let i = 0; i < n && lib.length; i++) hand.push(lib.shift()!); };
  const rockMana = () => battlefield.reduce((a, c) => a + (c.role.kind === "rock" ? c.role.mana : 0), 0);
  const amplifiers = () => battlefield.filter((c) => c.role.kind === "amplifier").length;
  const lifeLine = () => opp.map((x) => Math.max(0, x)).join(" / ");

  const conditionMet = (c: Condition): boolean => {
    switch (c.kind) {
      case "commanderOnBattlefield": return commanderOn;
      case "nonlandMana": return rockMana() + (commanderOn && plan.commander.manaFromCounters ? 1 : 0) >= c.min;
      case "stormLethal": {
        const per = commanderOn ? hookDamage : 0;
        return storm + 1 >= opp.reduce((a, x) => a + Math.max(0, x - per), 0);
      }
      case "opponentsDead": return opp.every((x) => x <= 0);
      case "minLands": return lands >= c.n;
    }
  };

  /** Fills each piece from the battlefield first (free), then the command zone, then the hand. */
  const evaluate = (w: WinCondition): Evaluation => {
    const used = new Set<SimCard>();
    const fills: Fill[] = [];
    const missingIds: string[][] = [];
    for (const piece of w.pieces) {
      const ids = piece.oracleIds;
      let card = battlefield.find((c) => !used.has(c) && ids.includes(c.oracleId));
      let fill: Fill | null = card ? { card, from: "battlefield", cost: 0 } : null;
      if (!fill) {
        card = command.find((c) => !used.has(c) && ids.includes(c.oracleId));
        if (card) fill = { card, from: "command", cost: card.cost };
      }
      if (!fill) {
        card = hand.find((c) => !used.has(c) && ids.includes(c.oracleId));
        if (card) fill = { card, from: "hand", cost: card.cost };
      }
      if (fill) { used.add(fill.card); fills.push(fill); } else missingIds.push(ids);
    }
    return { missing: missingIds.length, fills, missingIds };
  };

  /** Cards a counting win condition still needs: 100 if it is the last piece, 60 otherwise. */
  const needs = () => {
    const map = new Map<string, number>();
    for (const w of counting) {
      const ev = evaluate(w);
      const value = ev.missing === 1 ? 100 : 60;
      for (const ids of ev.missingIds) for (const id of ids) map.set(id, Math.max(map.get(id) ?? 0, value));
    }
    return map;
  };

  const score = (c: SimCard, need: Map<string, number>): number => {
    const piece = need.get(c.oracleId);
    if (piece) return piece;
    const preferred = plan.lookFor.indexOf(c.role.kind);
    const bonus = preferred >= 0 ? 65 - 3 * preferred : 0;
    let base = 5;
    switch (c.role.kind) {
      case "tutor": base = 55; break;
      case "land": case "landcycler": base = lands + hand.filter(landish).length < 5 ? 70 : 12; break;
      case "rock": base = turn <= 4 ? 50 : 22; break;
      case "amplifier": base = 58; break;
      case "drawEngine": base = 40; break;
      case "cantrip": case "frantic": case "gush": case "wheel": case "ritual": base = 35; break;
      case "burn": base = 20; break;
      case "blank": base = plan.winConditions.some((w) => w.pieces.some((p) => p.oracleIds.includes(c.oracleId))) ? 30 : 5; break;
    }
    return Math.max(base, bonus);
  };

  const dig = (look: number, take: number) => {
    const need = needs();
    const seen = lib.splice(0, look);
    seen.sort((a, b) => score(b, need) - score(a, need));
    hand.push(...seen.slice(0, take));
    lib.push(...seen.slice(take));
    return seen.slice(0, take).map((c) => c.name);
  };

  const runEffects = (effects: Effect[]) => {
    for (const e of effects) {
      switch (e.kind) {
        case "addCounter": counters++; break;
        case "damageEachOpponent": opp = opp.map((x) => x - e.n); break;
        case "draw": drawN(e.n); break;
        case "drawPerAmplifier": { const n = amplifiers(); if (n) drawN(e.n * n); break; }
        case "addMana": mana += e.n; break;
      }
    }
  };
  const fire = (on: EngineHook["on"], card: SimCard | null) => {
    if (!commanderOn) return;
    for (const h of hooks) {
      if (h.on !== on) continue;
      if (card && h.filter?.noncreature && card.types.includes("creature")) continue;
      if (card && h.filter?.type && !card.types.includes(h.filter.type)) continue;
      runEffects(h.effects);
    }
  };

  /** Pays for and resolves a card from hand. */
  const cast = (c: SimCard, cost: number, message?: string) => {
    hand.splice(hand.indexOf(c), 1);
    pay(cost);
    storm++;
    const creature = c.types.includes("creature");
    fire("spellCast", c);
    say(message ?? `casts ${c.name}${commanderOn && !creature && hooks.length ? ` (${primary?.name.split(",")[0]} ${counters})` : ""}`);
    if (isPermanent(c)) {
      battlefield.push(c);
      if (creature) fire("creatureEnters", c);
    }
    const r = c.role;
    switch (r.kind) {
      case "rock": mana += r.mana; break;
      case "ritual":
        mana += r.adds;
        say(`  adds ${r.adds} mana`);
        if (r.impulse && commanderOn) {
          const k = lib.splice(0, r.impulse);
          hand.push(...k);
          temp.push(...k);
          say(`  exiles ${k.map((z) => z.name).join(", ")} to play this turn`);
        }
        break;
      case "cantrip": say(`  keeps ${dig(r.look, r.take).join(", ") || "nothing"}`); break;
      case "wheel": { const k = Math.max(hand.length, 6); hand.length = 0; drawN(k); say(`  wheels into ${k} cards`); break; }
      case "frantic": {
        mana += 3;
        drawN(2);
        const need = needs();
        hand.sort((a, b) => score(a, need) - score(b, need));
        hand.splice(0, 2);
        say("  draws 2, discards 2");
        break;
      }
      case "gush": lands -= 2; landMana -= 2; hand.push({ ...ISLAND }, { ...ISLAND }); drawN(2); break;
      case "drawEngine": engines.push({ card: c, draws: r.draws, turnsLeft: r.turns ?? null, growing: !!r.growing, drawn: 0, since: turn }); break;
      case "burn": {
        let i = 0;
        opp.forEach((v, j) => { if (v > 0 && (opp[i] <= 0 || v < opp[i])) i = j; });
        opp[i] -= r.damage;
        break;
      }
    }
  };

  const castable = (c: SimCard): boolean => {
    if (c.cost > avail()) return false;
    switch (c.role.kind) {
      case "land": case "landcycler": case "blank": case "tutor": return false;
      case "frantic": return lands >= 3 && avail() >= 3;
      case "gush": return lands >= 4;
      case "wheel": { const need = needs(); return hand.filter((z) => z !== c && score(z, need) >= 55).length <= 1; }
      case "burn": return commanderOn;
      default: return true;
    }
  };
  const condOk = (w?: Condition) => !w || conditionMet(w);

  const tutor = (forWhat: "missingPiece" | RoleKind): boolean => {
    for (const t of hand.filter((x) => x.role.kind === "tutor" && avail() >= x.cost)) {
      if (t.role.kind !== "tutor") continue;
      const filter = t.role.find;
      let li = -1;
      if (forWhat === "missingPiece") {
        for (const w of counting) {
          const ev = evaluate(w);
          if (ev.missing !== 1) continue;
          li = lib.findIndex((x) => ev.missingIds[0].includes(x.oracleId) && matchesFilter(x, filter));
          if (li >= 0) break;
        }
      } else {
        li = lib.findIndex((x) => x.role.kind === forWhat && matchesFilter(x, filter));
      }
      if (li < 0) continue;
      const found = lib.splice(li, 1)[0];
      cast(t, t.cost);
      if (t.role.toTop) { lib.unshift(found); say(`  puts ${found.name} on top`); } else { hand.push(found); say(`  finds ${found.name}`); }
      if (t.role.discardRandom && hand.length) {
        const lost = hand.splice(Math.floor(rng() * hand.length), 1)[0];
        say(`  discards ${lost.name} at random`);
      }
      return true;
    }
    return false;
  };

  const deploy = (eot: boolean): boolean => {
    for (const w of counting) {
      const ev = evaluate(w);
      if (ev.missing > 1) continue;
      for (let i = 0; i < w.pieces.length && i < ev.fills.length; i++) {
        const f = ev.fills[i];
        const piece = w.pieces.find((p) => p.oracleIds.includes(f.card.oracleId));
        if (f.from !== "hand" || piece?.zone !== "battlefield" || !isPermanent(f.card)) continue;
        if (f.card.flash !== eot) continue;
        if (eot ? mana < f.card.cost : avail() < f.card.cost) continue;
        cast(f.card, f.card.cost, eot ? `flashes in ${f.card.name} at end of turn` : undefined);
        return true;
      }
    }
    return false;
  };

  const act = (): boolean => {
    for (const rule of rules) {
      switch (rule.do) {
        case "commander": {
          const c = command.find((x) => avail() >= x.cost);
          if (!c) break;
          pay(c.cost);
          storm++;
          command.splice(command.indexOf(c), 1);
          battlefield.push(c);
          if (c === primary) { commanderOn = true; counters = 0; commanderTurn = turn; }
          say(`casts ${c.name} from the command zone`, "commander");
          return true;
        }
        case "cast": {
          if (rule.role === "tutor") { if (tutor("missingPiece")) return true; break; }
          const c = hand.find((x) => x.role.kind === rule.role && castable(x));
          if (c && condOk(rule.when)) { cast(c, c.cost); return true; }
          break;
        }
        case "tutor": if (tutor(rule.for)) return true; break;
        case "deploy": if (deploy(false)) return true; break;
        case "dig": {
          const weight = (c: SimCard) => (c.role.kind === "frantic" || c.role.kind === "gush" ? 0 : c.role.kind === "ritual" ? 1 : c.cost);
          const opts = hand.filter((x) => rule.prefer.includes(x.role.kind) && castable(x));
          if (!opts.length) break;
          opts.sort((a, b) => weight(a) - weight(b));
          cast(opts[0], opts[0].role.kind === "gush" ? 0 : opts[0].cost, opts[0].role.kind === "gush" ? "casts Gush, returning two Islands" : undefined);
          return true;
        }
      }
    }
    return false;
  };

  type Check = { executable: WinCondition | null; cost: number };
  const checkWin = (): Check => {
    for (const w of counting) {
      const ev = evaluate(w);
      if (ev.missing > 0 || !(w.requires ?? []).every(conditionMet)) continue;
      const cost = w.manaNeeded + ev.fills.reduce((a, f) => a + f.cost, 0);
      if (firstAssembled === null) firstAssembled = turn;
      if (avail() >= cost) return { executable: w, cost };
      if (!assembledSeen.has(w.id)) {
        assembledSeen.add(w.id);
        say(`Assembled ${w.label}, but needs ${cost} mana, have ${avail()}`, "assembled");
      }
    }
    return { executable: null, cost: 0 };
  };

  // Mulligan: the first is free, the second bottoms the least useful card.
  const mustSee = plan.mulligan.mustSee ?? [];
  for (;;) {
    lib = shuffle([...deck.library]);
    hand = lib.splice(0, 7);
    const n = hand.filter(landish).length;
    const ok = n >= plan.mulligan.minLands && n <= plan.mulligan.maxLands && mustSee.every((k) => hand.some((c) => c.role.kind === k));
    if (ok || mulligans >= MAX_MULLIGANS) break;
    mulligans++;
  }
  if (mulligans >= MAX_MULLIGANS) {
    const need = needs();
    hand.sort((a, b) => score(a, need) - score(b, need));
    lib.push(hand.shift()!);
  }
  say(`Opening hand${mulligans ? ` after ${mulligans} mulligan${mulligans > 1 ? "s" : ""}` : ""}: ${hand.map((c) => c.name).join(", ")}`);

  for (turn = 1; turn <= turnCap; turn++) {
    mana = 0; counterUsed = false; storm = 0; temp = [];
    say(`Turn ${turn}`, "turn");
    for (const e of engines) {
      if (turn <= e.since || e.turnsLeft === 0) continue;
      const n = e.growing ? ++e.drawn : e.draws;
      drawN(n);
      if (e.turnsLeft !== null) e.turnsLeft--;
      say(`${e.card.name} draws ${n}`);
    }
    fire("upkeep", null);
    if (!(turn === 1 && onPlay)) { drawN(1); say(`draws ${hand[hand.length - 1]?.name ?? "nothing"}`); }

    let debt = 0;
    let i = hand.findIndex((c) => c.role.kind === "land");
    if (i >= 0) {
      const l = hand.splice(i, 1)[0];
      lands++;
      landMana += l.role.kind === "land" ? l.role.mana : 1;
      say(`plays ${l.name}`);
      fire("landPlayed", l);
    } else {
      i = hand.findIndex((c) => c.role.kind === "landcycler");
      if (i >= 0 && lands >= 1) {
        const l = hand.splice(i, 1)[0];
        lands++; landMana++; debt = 1;
        say(`cycles ${l.name} for a land and plays it`);
      }
    }
    mana = landMana + rockMana() - debt;

    for (let k = 0; k < STEP_CAP; k++) {
      const { executable } = checkWin();
      if (executable) {
        say(`Wins with ${executable.label}. Opponents at ${lifeLine()} before the combo.`, "executed");
        return { executed: turn, assembled: firstAssembled ?? turn, line: executable.label, commanderTurn, mulligans, log: L };
      }
      if (!act()) break;
    }
    while (deploy(true)) { /* flash pieces at end of turn */ }
    for (const t of temp) { const j = hand.indexOf(t); if (j >= 0) hand.splice(j, 1); }
    say(`ends turn: ${primary ? (commanderOn ? `${primary.name.split(",")[0]} ${plan.commander.manaFromCounters || hooks.length ? `at ${counters}` : "out"}` : `${primary.name.split(",")[0]} not cast`) + ", " : ""}opponents at ${lifeLine()}`);
  }
  say(`No win by turn ${turnCap}.`, "executed");
  return { executed: null, assembled: firstAssembled, line: null, commanderTurn, mulligans, log: L };
}
