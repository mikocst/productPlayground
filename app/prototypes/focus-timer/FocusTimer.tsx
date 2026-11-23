"use client";

import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_SETTINGS, STORAGE_KEY } from "./data";
import type { TimerSettings } from "./types";
import { formatTime } from "./utils";
import { TimerControls } from "./TimerControls";

export function FocusTimer() {
  const [settings, setSettings] = useState<TimerSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) as TimerSettings : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [seconds, setSeconds] = useState(DEFAULT_SETTINGS.minutes * 60);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  function changeSettings(next: TimerSettings) {
    setSettings(next); setSeconds(next.minutes * 60); setRunning(false);
  }
  function reset() { changeSettings(DEFAULT_SETTINGS); }
  function randomize() { changeSettings({ minutes: 10 + Math.floor(Math.random() * 9) * 5, breakMinutes: 3 + Math.floor(Math.random() * 6) }); }

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <div className="lg:flex lg:items-start lg:gap-6">
        <section className="mb-6 flex flex-1 flex-col items-center rounded-xl border border-border bg-card p-8 text-center lg:mb-0">
          <p className="text-sm text-muted-foreground">Focus</p>
          <p className="my-5 font-mono text-6xl font-semibold tabular-nums sm:text-7xl">{formatTime(seconds)}</p>
          <div className="flex gap-2">
            <Button onClick={() => setRunning((value) => !value)} className="size-12 px-0" aria-label={running ? "Pause" : "Start"}>{running ? <Pause /> : <Play />}</Button>
            <Button onClick={() => { setSeconds(settings.minutes * 60); setRunning(false); }} className="size-12 px-0" aria-label="Reset timer"><RotateCcw /></Button>
          </div>
        </section>
        <TimerControls settings={settings} onChange={changeSettings} onReset={reset} onRandomize={randomize} />
      </div>
    </main>
  );
}
