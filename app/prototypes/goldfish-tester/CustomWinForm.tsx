"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Condition, WinCondition, WinPiece, Zone } from "./types";
import type { Goldfish } from "./useGoldfish";
import { Select } from "./Select";
import { field, goldButton, quietButton } from "./Window";

const ZONES: { value: Zone; label: string }[] = [
  { value: "battlefield", label: "on the battlefield" },
  { value: "hand", label: "in hand" },
  { value: "command", label: "in the command zone" },
];

/** Writes a custom win condition from cards in the deck: Grapeshot for exact lethal, a commander line, etc. */
export function CustomWinForm({ g, onDone }: { g: Goldfish; onDone: () => void }) {
  const cards = g.composed.deck.entries.filter((e) => e.data).map((e) => e.data!).sort((a, b) => a.name.localeCompare(b.name));
  const [label, setLabel] = useState("");
  const [pieces, setPieces] = useState<WinPiece[]>([]);
  const [pick, setPick] = useState("");
  const [zone, setZone] = useState<Zone>("battlefield");
  const [mana, setMana] = useState(0);
  const [commanderOut, setCommanderOut] = useState(false);
  const [storm, setStorm] = useState(false);

  const addPiece = () => {
    const c = cards.find((x) => x.oracleId === pick);
    if (!c) return;
    setPieces((p) => [...p, { oracleIds: [c.oracleId], label: c.name, zone }]);
    setPick("");
  };
  const save = () => {
    const requires: Condition[] = [...(commanderOut ? [{ kind: "commanderOnBattlefield" } as const] : []), ...(storm ? [{ kind: "stormLethal" } as const] : [])];
    const win: WinCondition = {
      id: `custom:${Date.now().toString(36)}`,
      label: label.trim() || pieces.map((p) => p.label.split(",")[0]).join(" + "),
      source: "custom",
      state: "counts",
      pieces,
      manaNeeded: mana,
      ...(requires.length ? { requires } : {}),
    };
    g.setCustom((list) => [...list, win]);
    onDone();
  };

  return (
    <div className="grid gap-3 rounded-lg border border-white/30 bg-secondary/60 p-3">
      <label className="grid gap-1 text-sm">Name<input className={field} value={label} placeholder="Thassa's Oracle with an empty library" onChange={(e) => setLabel(e.target.value)} /></label>
      <div className="grid gap-1 text-sm">
        <span>Pieces</span>
        {pieces.length > 0 && (
          <ul className="grid gap-1">
            {pieces.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-sm">
                <span>{p.label} <span className="text-white/60">{ZONES.find((z) => z.value === p.zone)?.label}</span></span>
                <Button className={quietButton} onClick={() => setPieces((list) => list.filter((_, j) => j !== i))}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
          <Select aria-label="Card" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a card…</option>
            {cards.map((c) => <option key={c.oracleId} value={c.oracleId}>{c.name}</option>)}
          </Select>
          <Select aria-label="Where it must be" value={zone} onChange={(e) => setZone(e.target.value as Zone)}>
            {ZONES.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
          </Select>
          <Button className={quietButton} disabled={!pick} onClick={addPiece}>Add piece</Button>
        </div>
      </div>
      <label className="grid gap-1 text-sm">
        Extra mana to execute, beyond casting the pieces
        <input type="number" min={0} max={20} className={field} value={mana} onChange={(e) => setMana(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} />
      </label>
      <fieldset className="flex flex-wrap gap-x-4 text-sm">
        <legend className="mb-1">Also requires</legend>
        <label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-amber-400" checked={commanderOut} onChange={() => setCommanderOut(!commanderOut)} />Commander on the battlefield</label>
        <label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-amber-400" checked={storm} onChange={() => setStorm(!storm)} />Storm count is lethal</label>
      </fieldset>
      <div className="flex gap-2">
        <Button className={goldButton} disabled={!pieces.length} onClick={save}>Add win condition</Button>
        <Button className={quietButton} onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
