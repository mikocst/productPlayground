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
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:px-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Goldfish Tester</h1>
        <p className="mt-1 text-sm text-muted-foreground">How fast does your Commander deck execute its win when nobody interacts? Loaded with a Vivi Ornitier list; paste yours below.</p>
      </header>

      <ResultsWindow g={g} />
      <LinesWindow g={g} />
      <SampleGame g={g} />

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

      <details className="rounded-xl border border-border bg-card p-4 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">What the simulator assumes</summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
          {ASSUMPTIONS.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </details>
    </main>
  );
}
