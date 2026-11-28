"use client";

// Problem flags first (Not found blocks a run; Auto-guessed and Unmodelled don't), then every card and its role.

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { describeRole } from "./classify";
import type { DeckEntry, Issue } from "./deck";
import { RolePicker } from "./RolePicker";
import type { Goldfish } from "./useGoldfish";
import { quietButton } from "./Window";

const ISSUE: Record<Issue, { label: string; tone: string; help: string }> = {
  notFound: { label: "Not found", tone: "border-rose-300 bg-rose-500/25 text-white", help: "A typo or a card newer than the data. Pick a match or remove it." },
  ambiguous: { label: "Ambiguous", tone: "border-rose-300 bg-rose-500/25 text-white", help: "This name matches several cards. Choose one." },
  guessed: { label: "Auto-guessed", tone: "border-amber-300 bg-amber-500/20 text-white", help: "Read from oracle text. Confirm or change it." },
  unmodelled: { label: "Unmodelled", tone: "border-white/40 bg-white/10 text-white", help: "Played as a blank. Give it a role if it matters to the pilot." },
};
const SOURCE: Record<string, string> = { curated: "Curated", auto: "From card data", guess: "Guess", fix: "Your fix", interaction: "Dead in a goldfish", unmodelled: "Blank" };

function Entry({ e, g }: { e: DeckEntry; g: Goldfish }) {
  const [editing, setEditing] = useState(false);
  const id = e.data?.oracleId;
  return (
    <li className="border-t border-white/15 py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <span className="tabular-nums text-white/60">{e.qty}×</span> {e.name}
          {e.commander && <span className="ml-2 text-xs text-amber-200">Commander</span>}
        </span>
        {e.issue && <Badge className={cn("border", ISSUE[e.issue].tone)}>{ISSUE[e.issue].label}</Badge>}
        {e.card && !e.commander && <span className="text-xs text-white/70">{describeRole(e.card.role)} · {SOURCE[e.source ?? "auto"]}</span>}
      </div>
      {e.issue === "notFound" && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {e.suggestions.map((s) => <Button key={s} className={quietButton} onClick={() => g.replaceCard(e.name, s)}>{s}</Button>)}
          {!e.suggestions.length && <span className="text-xs text-white/70">No close matches.</span>}
          <Button className={quietButton} onClick={() => g.replaceCard(e.name, null)}>Remove</Button>
        </div>
      )}
      {e.card && id && !e.commander && (
        editing ? (
          <RolePicker card={e.card} hasFix={!!g.fixes[id]} onCancel={() => setEditing(false)} onClear={() => { g.setFix(id, null); setEditing(false); }} onSave={(fix) => { g.setFix(id, fix); setEditing(false); }} />
        ) : (
          <div className="mt-1 flex flex-wrap gap-2">
            {e.issue === "guessed" && <Button className={quietButton} onClick={() => g.setFix(id, { role: e.card!.role, cost: e.card!.cost })}>Confirm</Button>}
            <Button className={quietButton} onClick={() => setEditing(true)}>{e.issue === "unmodelled" ? "Pick a role" : "Change role"}</Button>
          </div>
        )
      )}
    </li>
  );
}

export function CardList({ g }: { g: Goldfish }) {
  const entries = g.composed.deck.entries;
  const flagged = entries.filter((e) => e.issue);
  const rest = entries.filter((e) => !e.issue);
  const counts = (Object.keys(ISSUE) as Issue[]).map((k) => [k, flagged.filter((e) => e.issue === k).length] as const).filter(([, n]) => n);
  return (
    <div className="mt-4">
      {flagged.length > 0 ? (
        <>
          <h3 className="text-sm font-semibold">Needs a look</h3>
          <p className="mb-1 text-xs text-white/70">{counts.map(([k, n]) => `${n} ${ISSUE[k].label.toLowerCase()}`).join(" · ")}. {counts.length === 1 ? ISSUE[counts[0][0]].help : "Not found cards block a run; the others don't."}</p>
          <ul>{flagged.map((e) => <Entry key={e.data?.oracleId ?? e.name} e={e} g={g} />)}</ul>
        </>
      ) : <p className="text-sm text-white/80">Every card resolved and has a role.</p>}
      <details className="mt-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Every card and its role ({rest.length})</summary>
        <ul>{rest.map((e) => <Entry key={e.data?.oracleId ?? e.name} e={e} g={g} />)}</ul>
      </details>
    </div>
  );
}
