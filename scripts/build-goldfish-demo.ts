// Bakes the goldfish-tester demo deck's card data so the demo runs offline, before any lookup.
// Run with: npx tsx scripts/build-goldfish-demo.ts   (re-run if the demo list changes)

import fs from "node:fs";
import path from "node:path";
import { resolveLines } from "../lib/goldfish/scryfall";
import { DEMO_DECK } from "../app/prototypes/goldfish-tester/demoDeck";
import { lineKey, parseDecklist } from "../app/prototypes/goldfish-tester/parse";
import type { CardData } from "../app/prototypes/goldfish-tester/types";

async function main() {
  const lines = parseDecklist(DEMO_DECK);
  const { cards, misses } = await resolveLines(lines.map((l) => ({ name: l.name })));
  if (misses.length) throw new Error(`Unresolved demo cards: ${misses.map((m) => m.query).join(", ")}`);
  const byName: Record<string, CardData> = {};
  lines.forEach((l, i) => { byName[lineKey(l)] = cards[i]!; });
  const out = path.join(process.cwd(), "app", "prototypes", "goldfish-tester", "demoCards.json");
  fs.writeFileSync(out, JSON.stringify(byName) + "\n");
  console.log(`Wrote ${Object.keys(byName).length} cards to ${path.relative(process.cwd(), out)}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
