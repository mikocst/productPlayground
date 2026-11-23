"use client";

import { Button } from "@/components/ui/button";
import type { TimerSettings } from "./types";

export function TimerControls({ settings, onChange, onReset, onRandomize }: {
  settings: TimerSettings;
  onChange: (settings: TimerSettings) => void;
  onReset: () => void;
  onRandomize: () => void;
}) {
  return (
    <aside className="rounded-xl border border-border bg-card p-4 lg:w-64">
      <h2 className="mb-4 font-semibold">Session</h2>
      <label className="mb-4 block text-sm">
        Focus minutes
        <input type="range" min="5" max="60" step="5" value={settings.minutes} onChange={(event) => onChange({ ...settings, minutes: Number(event.target.value) })} className="mt-2 w-full accent-primary" />
        <span className="mt-1 block text-muted-foreground">{settings.minutes} min</span>
      </label>
      <label className="mb-5 block text-sm">
        Break minutes
        <input type="range" min="1" max="20" step="1" value={settings.breakMinutes} onChange={(event) => onChange({ ...settings, breakMinutes: Number(event.target.value) })} className="mt-2 w-full accent-primary" />
        <span className="mt-1 block text-muted-foreground">{settings.breakMinutes} min</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={onRandomize}>Surprise me</Button>
        <Button onClick={onReset} className="border border-border bg-card text-foreground hover:bg-muted">Reset</Button>
      </div>
    </aside>
  );
}
