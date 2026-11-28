"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { DeckPanel } from "./DeckPanel";
import { LinesWindow } from "./LinesWindow";
import { PrimerForm } from "./PrimerForm";
import { ResultsWindow } from "./ResultsWindow";
import { SampleGame } from "./SampleGame";
import { useGoldfish } from "./useGoldfish";
import { WinConditionsPanel } from "./WinConditionsPanel";
import { Window } from "./Window";

const ASSUMPTIONS = [
  "Pure goldfish: three opponents at 40 life who never interact. Counterspells and removal sit in hand as dead cards.",
  "Executed turn is the first turn the deck has every piece of a counting win condition and the mana to use it. Assembled turn is when the pieces were first all there.",
  "Mana colours are ignored. Each land makes one mana unless curated otherwise; rocks tap the turn they come down.",
  "The first mulligan is free; the second bottoms the least useful card. Hands keep after two mulligans.",
  "Card selection keeps the most useful cards: the last missing combo piece, then other pieces, then your look-for list, lands when short, rocks early.",
  "Tutors fire when a win condition is one piece away and the tutor can find it.",
  "Spellbook combos count once their pieces and mana are present. Prerequisites the engine can't read are listed for you to review.",
  "It's a heuristic pilot, not a perfect player. Compare versions of a deck rather than reading it as an exact win rate.",
];

export function GoldfishTester() {
  const g = useGoldfish();
  const [tab, setTab] = useState("deck");
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:px-5 lg:max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Goldfish Tester</h1>
        <p className="mt-1 text-sm text-muted-foreground">How fast does your Commander deck execute its win when nobody interacts? Loaded with a Vivi Ornitier list; paste yours below.</p>
      </header>

      {/* Bento on desktop: results span two rows on the left; lines and the sample game stack on the right; setup spans
          the full width. Row 1 hugs "Which line won", and row 2 takes the rest of the results' height, so the
          sample game's log fills that space and scrolls instead of stretching the tiles. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[auto_1fr_auto]">
        <div className="lg:row-span-2"><ResultsWindow g={g} /></div>
        <div><LinesWindow g={g} /></div>
        <div><SampleGame g={g} /></div>
        <div className="lg:col-span-2">
          <Window title="Setup" id="gf-setup">
            <Tabs
              value={tab}
              onValueChange={setTab}
              pillClassName="bg-white"
              activeClassName="font-medium text-primary"
              idleClassName="text-white/70 hover:text-white"
              tabs={[
                { id: "deck", title: "Deck", content: <DeckPanel g={g} /> },
                { id: "wins", title: "Win conditions", content: <WinConditionsPanel g={g} /> },
                { id: "plan", title: "Game plan", content: <PrimerForm g={g} onWins={() => setTab("wins")} /> },
              ]}
            />
          </Window>
        </div>
      </div>

      <details className="rounded-xl border border-border bg-card p-4 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">What the simulator assumes</summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
          {ASSUMPTIONS.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </details>
    </main>
  );
}
