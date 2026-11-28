// Gate check for the goldfish tester: the data-driven engine vs the original Vivi Goldfish Simulator.
// Usage: npx tsx scripts/goldfish-parity.ts [path/to/vivi-sim.html] [games] [seed]
// Without the HTML file it prints the new engine's numbers only.

import fs from "node:fs";
import { buildDeck } from "../app/prototypes/goldfish-tester/deck";
import demoCards from "../app/prototypes/goldfish-tester/demoCards.json";
import { DEMO_DECK } from "../app/prototypes/goldfish-tester/demoDeck";
import { lineKey, parseDecklist } from "../app/prototypes/goldfish-tester/parse";
import { draftPlan } from "../app/prototypes/goldfish-tester/plan";
import { runMany } from "../app/prototypes/goldfish-tester/runner";
import type { CardData } from "../app/prototypes/goldfish-tester/types";
import { mergeWins, viviWins } from "../app/prototypes/goldfish-tester/wins";

const [htmlPath = "zPlansAndContext/vivi-sim.html", gamesArg = "5000", seedArg = "1126"] = process.argv.slice(2);
const games = Number(gamesArg);
const seed = Number(seedArg);
const cards = demoCards as Record<string, CardData>;

type Legacy = { win: number | null; line: string | null };
type LegacyApi = { parse: (t: string) => { cards: unknown[] }; mulberry: (s: number) => () => number; sim: (d: unknown[], r: () => number, p: boolean, m: number, l: boolean) => Legacy; DECK_DEFAULT: string };

function legacy(onPlay: boolean) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const script = html.slice(html.indexOf("const DECK_DEFAULT"), html.indexOf("const $=s=>"));
  const api = new Function(`${script}; return { parse, mulberry, sim, DECK_DEFAULT };`)() as LegacyApi;
  const deck = api.parse(api.DECK_DEFAULT).cards;
  const rng = api.mulberry(seed);
  const byT = Array<number>(11).fill(0);
  const lines: Record<string, number> = {};
  const wins: number[] = [];
  for (let g = 0; g < games; g++) {
    const r = api.sim(deck, rng, onPlay, 10, false);
    if (r.win) { byT[r.win - 1]++; wins.push(r.win); lines[r.line!] = (lines[r.line!] ?? 0) + 1; } else byT[10]++;
  }
  wins.sort((a, b) => a - b);
  return { byT, median: wins[Math.floor(wins.length / 2)] ?? null, lines };
}

function current(onPlay: boolean) {
  const lines = parseDecklist(DEMO_DECK);
  const deck = buildDeck(lines, lines.map((l) => cards[lineKey(l)] ?? null), [], {}, null);
  const byName = new Map(Object.values(cards).map((c) => [c.name, c.oracleId]));
  const plan = { ...draftPlan(deck), winConditions: mergeWins(viviWins((n) => byName.get(n)), [], {}) };
  const s = runMany(deck.sim, plan, { games, seed, onPlay, turnCap: 10 });
  return { byT: s.executedByTurn, median: s.medianExecuted, lines: Object.fromEntries(s.lines.map((l) => [l.label, l.count])), summary: s, deck };
}

const pct = (n: number) => `${((100 * n) / games).toFixed(1)}%`.padStart(6);
for (const onPlay of [true, false]) {
  const now = current(onPlay);
  console.log(`\n${onPlay ? "On the play" : "On the draw"} · ${games} games · seed ${seed}`);
  console.log(`deck: ${now.deck.cardCount} cards, commander ${now.deck.commanders.map((c) => c.name).join(", ") || "none"}, flags ${now.deck.entries.filter((e) => e.issue).map((e) => `${e.name}:${e.issue}`).join(", ") || "none"}`);
  const head = "turn    " + [...Array(10)].map((_, i) => `T${i + 1}`.padStart(6)).join("") + "  None";
  console.log(head);
  let old: ReturnType<typeof legacy> | null = null;
  if (fs.existsSync(htmlPath)) {
    old = legacy(onPlay);
    console.log("vivi    " + old.byT.map(pct).join(""), ` median T${old.median}`);
  }
  console.log("engine  " + now.byT.map(pct).join(""), ` median T${now.median}`);
  console.log(`         assembled ${now.summary.meanGap?.toFixed(2)} turns before executing on average; won by T5 ${(100 * now.summary.wonByTarget).toFixed(1)}%`);
  if (old) {
    console.log("lines (vivi):  ", JSON.stringify(old.lines));
  }
  console.log("lines (engine):", JSON.stringify(now.lines));
}
