"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CardList } from "./CardList";
import type { Goldfish } from "./useGoldfish";
import { Select } from "./Select";
import { field, goldButton, quietButton } from "./Window";

export function DeckPanel({ g }: { g: Goldfish }) {
  const [url, setUrl] = useState("");
  const { deck } = g.composed;
  const loading = g.load.status === "loading";
  const lead = deck.commanders.map((c) => c.oracleId);

  return (
    <div className="grid gap-4 pt-3">
      <form className="grid gap-1.5" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void g.importUrl(url.trim()); }}>
        <label htmlFor="gf-url" className="text-sm font-medium">Import from a deck link</label>
        <div className="flex gap-2">
          <input id="gf-url" type="url" placeholder="https://archidekt.com/decks/…" className={field} value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button type="submit" className={quietButton} disabled={loading || !url.trim()}>Import</Button>
        </div>
        <p className="text-xs text-white/70">Archidekt imports directly. For Moxfield and others, export as plain text and paste below.</p>
      </form>

      <div className="grid gap-1.5">
        <label htmlFor="gf-deck" className="text-sm font-medium">Decklist</label>
        <textarea
          id="gf-deck"
          spellCheck={false}
          className={cn(field, "h-64 py-2 font-mono! text-sm! leading-snug!")}
          value={g.deckText}
          onChange={(e) => g.setDeckText(e.target.value)}
        />
        <p className="text-xs text-white/70">&quot;1 Sol Ring&quot;, &quot;1x Sol Ring&quot; or &quot;1 Sol Ring (CMR) 472&quot;. Put the commander under a Commander header or after a blank line at the end.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button className={goldButton} disabled={loading} onClick={() => void g.loadDeck(g.deckText)}>Load deck</Button>
          {g.load.status === "loading" && <span role="status" className="text-sm text-white/80">{g.load.message}</span>}
          {g.load.status === "error" && <span role="alert" className="text-sm text-rose-200">{g.load.message}</span>}
        </div>
      </div>

      <div className="rounded-lg border border-white/30 bg-secondary/50 p-3 text-sm">
        <p>
          <b className="tabular-nums">{deck.cardCount}</b> cards
          {deck.commanders.length ? <> · led by <b>{deck.commanders.map((c) => c.name).join(" & ")}</b></> : null}
        </p>
        {deck.warnings.map((w) => <p key={w} className="mt-1 text-amber-200">{w}</p>)}
        {deck.commanderOptions.length > 0 && (
          <label className="mt-2 grid gap-1 text-xs">
            Commander
            <Select value={lead[0] ?? ""} onChange={(e) => g.chooseCommanders(e.target.value ? [e.target.value] : [])}>
              <option value="">No commander</option>
              {deck.commanderOptions.map((c) => <option key={c.oracleId} value={c.oracleId}>{c.name}</option>)}
            </Select>
          </label>
        )}
      </div>

      {g.primer && (
        <details className="rounded-lg border border-white/30 bg-secondary/50 p-3 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Primer from the import</summary>
          <p className="whitespace-pre-wrap text-white/80">{g.primer}</p>
          <p className="mt-2 text-xs text-white/60">Read it, then set the matching answers on the Game plan tab.</p>
        </details>
      )}

      <CardList g={g} />
    </div>
  );
}
