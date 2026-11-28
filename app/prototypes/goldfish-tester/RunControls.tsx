"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GAME_OPTIONS, TURN_CAPS } from "./config";
import { Segmented } from "./Segmented";
import type { Goldfish } from "./useGoldfish";
import { field, goldButton, quietButton } from "./Window";

export function RunControls({ g }: { g: Goldfish }) {
  const { settings, setSettings, results, blocked } = g;
  const running = results.status === "running";
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor="gf-games" className="mb-1 block text-sm font-medium">Games</label>
        <select id="gf-games" className={field} value={settings.games} onChange={(e) => setSettings({ ...settings, games: Number(e.target.value) })}>
          {GAME_OPTIONS.map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
        </select>
      </div>
      <div>
        <p className="mb-1 text-sm font-medium">Turn order</p>
        <Segmented label="Turn order" value={settings.onPlay ? "play" : "draw"} options={[{ value: "play", label: "Play" }, { value: "draw", label: "Draw" }]} onChange={(v) => setSettings({ ...settings, onPlay: v === "play" })} />
      </div>
      <div>
        <p className="mb-1 text-sm font-medium">Turn cap</p>
        <Segmented label="Turn cap" value={settings.turnCap} options={TURN_CAPS.map((t) => ({ value: t, label: `${t} turns` }))} onChange={(v) => setSettings({ ...settings, turnCap: v })} />
      </div>
      <div>
        <label htmlFor="gf-seed" className="mb-1 block text-sm font-medium">Seed</label>
        <input id="gf-seed" inputMode="numeric" className={field} value={settings.seed} onChange={(e) => setSettings({ ...settings, seed: Math.abs(Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)) })} />
      </div>
      <Button className={cn(goldButton, "w-full text-base")} disabled={blocked || running} onClick={() => void g.runNow()}>
        {running ? "Simulating…" : "Run simulation"}
      </Button>
      {blocked && g.load.status !== "loading" && <p className="text-xs text-rose-200">Fix the cards marked Not found first.</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button className={cn(quietButton, "px-2")} onClick={g.reset}>Reset</Button>
        <Button className={cn(quietButton, "px-2")} onClick={g.surprise} disabled={blocked} title="Run again with a random seed">Surprise me</Button>
      </div>
      <Button className={quietButton} onClick={() => void g.share()}>Copy share link</Button>
      {g.notice && <p role="status" className="text-xs text-white/80">{g.notice}</p>}
    </div>
  );
}
