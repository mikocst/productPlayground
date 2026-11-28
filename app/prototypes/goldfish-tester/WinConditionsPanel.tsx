"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CustomWinForm } from "./CustomWinForm";
import type { Condition, WinCondition } from "./types";
import type { Goldfish } from "./useGoldfish";
import { quietButton } from "./Window";

const ZONE_WORD = { battlefield: "out", hand: "in hand", command: "in the command zone" } as const;

function conditionText(c: Condition): string {
  switch (c.kind) {
    case "commanderOnBattlefield": return "commander out";
    case "nonlandMana": return `${c.min}+ mana from nonland permanents`;
    case "stormLethal": return "storm count lethal";
    case "opponentsDead": return "every opponent at 0 life";
    case "minLands": return `${c.n}+ lands`;
  }
}

function WinRow({ w, g }: { w: WinCondition; g: Goldfish }) {
  const counts = w.state === "counts";
  const covered = w.source === "spellbook" && !g.states[w.id] && !counts;
  return (
    <li className="border-t border-white/15 py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{w.label} <Badge className="ml-1 border-white/30 bg-white/10 text-white/80">{w.source === "spellbook" ? "Spellbook" : w.source === "custom" ? "Custom" : "Built in"}</Badge></p>
          <p className="text-xs text-white/70">
            {w.pieces.length ? w.pieces.map((p) => `${p.label} ${ZONE_WORD[p.zone]}`).join(" + ") : "No pieces"}
            {w.manaNeeded ? ` · ${w.manaNeeded} more mana` : ""}
            {w.requires?.length ? ` · needs ${w.requires.map(conditionText).join(", ")}` : ""}
          </p>
          {covered && <p className="text-xs text-white/60">Ignored by default: a custom condition already covers these cards.</p>}
        </div>
        <Switch checked={counts} onClassName="bg-amber-500" offClassName="bg-white/25" onCheckedChange={(v) => g.setStates((s) => ({ ...s, [w.id]: v ? "counts" : "ignored" }))}>
          <span className="w-16 text-left">{counts ? "Counts" : "Ignored"}</span>
        </Switch>
      </div>
      {(w.notes?.length || w.url || w.source === "custom") && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
          {w.notes?.length ? (
            <details className="w-full">
              <summary className="flex min-h-11 cursor-pointer items-center text-white/80">Prerequisites to review ({w.notes.length})</summary>
              <ul className="list-disc pl-5 text-white/70">{w.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </details>
          ) : null}
          {w.url && <a className="inline-flex min-h-11 items-center text-amber-200 underline-offset-4 hover:underline" href={w.url} target="_blank" rel="noreferrer">Open on Commander Spellbook</a>}
          {w.source === "custom" && <Button className={quietButton} onClick={() => g.setCustom((list) => list.filter((x) => x.id !== w.id))}>Remove</Button>}
        </div>
      )}
    </li>
  );
}

export function WinConditionsPanel({ g }: { g: Goldfish }) {
  const [adding, setAdding] = useState(false);
  const { combos } = g;
  const wins = g.composed.wins;
  const live = wins.filter((w) => w.state === "counts").length;
  return (
    <div className="grid gap-3 pt-3">
      <p className="text-sm text-white/80">
        {live} of {wins.length} count as a win. Ignored lines stay in the deck, but assembling them doesn&apos;t end the game, and tutors and card selection stop chasing their pieces.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {combos.status === "idle" && <Button className={quietButton} onClick={() => void g.refetchCombos()}>Find combos with Commander Spellbook</Button>}
        {combos.status === "loading" && <span role="status">Asking Commander Spellbook…</span>}
        {combos.status === "ready" && <span className="text-white/80">Commander Spellbook: {combos.combos.length} combo{combos.combos.length === 1 ? "" : "s"} in the deck, {combos.almost} one card away.</span>}
        {combos.status === "error" && (<><span role="alert" className="text-rose-200">{combos.message}</span><Button className={quietButton} onClick={() => void g.refetchCombos()}>Retry</Button></>)}
      </div>
      <ul>{wins.map((w) => <WinRow key={w.id} w={w} g={g} />)}</ul>
      {adding ? <CustomWinForm g={g} onDone={() => setAdding(false)} /> : <Button className={quietButton} onClick={() => setAdding(true)}>Add a custom win condition</Button>}
    </div>
  );
}
