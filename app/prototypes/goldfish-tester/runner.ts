// Runs many seeded games and folds them into a RunSummary. Pure: used by the worker and the parity script.

import { simulate } from "./engine";
import { mulberry32 } from "./rng";
import type { GamePlan, GameResult, RunSettings, RunSummary, SimDeck } from "./types";

export function runMany(deck: SimDeck, plan: GamePlan, settings: RunSettings): RunSummary {
  const { games, seed, onPlay, turnCap } = settings;
  const rng = mulberry32(seed >>> 0 || 1);
  const executedByTurn = Array<number>(turnCap + 1).fill(0);
  const ghostByTurn = Array<number>(turnCap + 1).fill(0);
  const lines = new Map<string, number>();
  const wins: number[] = [];
  let gapSum = 0, gapN = 0, cmdSum = 0, cmdN = 0, mulls = 0;

  for (let g = 0; g < games; g++) {
    const r = simulate(deck, plan, rng, onPlay, turnCap, false);
    if (r.executed) {
      executedByTurn[r.executed - 1]++;
      wins.push(r.executed);
      if (r.line) lines.set(r.line, (lines.get(r.line) ?? 0) + 1);
    } else executedByTurn[turnCap]++;
    if (r.assembled && (r.executed === null || r.assembled < r.executed)) ghostByTurn[r.assembled - 1]++;
    if (r.assembled && r.executed) { gapSum += r.executed - r.assembled; gapN++; }
    if (r.commanderTurn) { cmdSum += r.commanderTurn; cmdN++; }
    if (r.mulligans) mulls++;
  }
  wins.sort((a, b) => a - b);
  const wonByTarget = executedByTurn.slice(0, plan.targetTurn).reduce((a, b) => a + b, 0);
  return {
    games,
    turnCap,
    onPlay,
    executedByTurn,
    ghostByTurn,
    lines: [...lines].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    medianExecuted: wins.length ? wins[Math.floor(wins.length / 2)] : null,
    wonByTarget: games ? wonByTarget / games : 0,
    meanGap: gapN ? gapSum / gapN : null,
    meanCommanderTurn: cmdN ? cmdSum / cmdN : null,
    mulliganShare: games ? mulls / games : 0,
  };
}

/** One logged game. Seeded from the run seed plus an offset, so "deal another" is reproducible too. */
export function sampleGame(deck: SimDeck, plan: GamePlan, settings: RunSettings, offset: number): GameResult {
  return simulate(deck, plan, mulberry32((settings.seed + offset * 7919) >>> 0 || 1), settings.onPlay, settings.turnCap, true);
}
