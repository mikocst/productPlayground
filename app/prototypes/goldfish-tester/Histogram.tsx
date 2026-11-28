"use client";

// Executed-turn histogram. Bars: rose before the target, gold on it, blue after, slate for "no win".
// The dashed ghost above a bar counts games that assembled on that turn but executed later (or never).
// Colours validated with the dataviz palette checker against the window surface (all checks pass).

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { RunSummary } from "./types";

const pct = (n: number, total: number) => (total ? (100 * n) / total : 0);

export function barTone(i: number, target: number, cap: number) {
  if (i === cap) return "bg-slate-500";
  if (i + 1 < target) return "bg-rose-600";
  if (i + 1 === target) return "bg-amber-600";
  return "bg-blue-500";
}

export function Histogram({ summary, target }: { summary: RunSummary; target: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const { executedByTurn: ex, ghostByTurn: ghost, games, turnCap } = summary;
  const max = Math.max(1, ...ex.map((v, i) => v + ghost[i]));
  const label = (i: number) => (i === turnCap ? "None" : `T${i + 1}`);

  return (
    <figure className="m-0">
      <div className="relative">
        <div className="grid h-56 items-end gap-1.5 border-b-2 border-white/60 pt-6 sm:h-64" style={{ gridTemplateColumns: `repeat(${turnCap + 1}, minmax(0, 1fr))` }}>
          {ex.map((v, i) => {
            const share = pct(v, games);
            return (
              <div
                key={i}
                tabIndex={0}
                role="img"
                aria-label={`${i === turnCap ? `No win by turn ${turnCap}` : `Executed on turn ${i + 1}`}: ${share.toFixed(1)}% (${v.toLocaleString()} games)${ghost[i] ? `. ${ghost[i].toLocaleString()} more assembled here but executed later.` : ""}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="relative flex h-full flex-col justify-end rounded-t outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                {share >= 0.5 && (
                  <span className="pointer-events-none absolute inset-x-0 text-center text-xs font-semibold tabular-nums text-white transition-[bottom] duration-400 ease-out motion-reduce:transition-none" style={{ bottom: `calc(${(100 * (v + ghost[i])) / max}% + 4px)` }}>
                    {share.toFixed(0)}%
                  </span>
                )}
                {ghost[i] > 0 && (
                  <div className="mb-0.5 rounded-t border border-dashed border-white/55 bg-white/10 transition-[height] duration-400 ease-out motion-reduce:transition-none" style={{ height: `${(100 * ghost[i]) / max}%` }} />
                )}
                <div className={cn("min-h-0.5 rounded-t transition-[height] duration-400 ease-out motion-reduce:transition-none", barTone(i, target, turnCap), hover === i && "brightness-110")} style={{ height: `${(100 * v) / max}%` }} />
              </div>
            );
          })}
        </div>
        {hover !== null && (
          <div role="status" className="pointer-events-none absolute -top-2 left-1/2 z-10 w-max max-w-[16rem] -translate-x-1/2 rounded-md border border-white/60 bg-secondary px-3 py-2 text-xs shadow-lg">
            <p className="font-semibold">{hover === turnCap ? `No win by turn ${turnCap}` : `Executed on turn ${hover + 1}`}</p>
            <p className="tabular-nums">{pct(ex[hover], games).toFixed(1)}% · {ex[hover].toLocaleString()} games</p>
            {ghost[hover] > 0 && <p className="text-white/70 tabular-nums">{ghost[hover].toLocaleString()} assembled here, executed later</p>}
          </div>
        )}
      </div>
      <div className="mt-1.5 grid gap-1.5 text-center text-xs text-white/70" style={{ gridTemplateColumns: `repeat(${turnCap + 1}, minmax(0, 1fr))` }}>
        {ex.map((_, i) => <span key={i}>{label(i)}</span>)}
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/75">
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm bg-rose-600" />Before target</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm bg-amber-600" />Target turn {target}</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm bg-blue-500" />Later</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm bg-slate-500" />No win by turn {turnCap}</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm border border-dashed border-white/55 bg-white/10" />Assembled, executed later</span>
      </figcaption>
      <details className="mt-3 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center text-white/80">Table view</summary>
        <table className="w-full text-left tabular-nums">
          <thead className="text-white/70"><tr><th className="py-1 font-medium">Turn</th><th className="py-1 font-medium">Executed</th><th className="py-1 font-medium">Share</th><th className="py-1 font-medium">Assembled, later</th></tr></thead>
          <tbody>
            {ex.map((v, i) => (
              <tr key={i} className="border-t border-white/15"><td className="py-1">{label(i)}</td><td>{v.toLocaleString()}</td><td>{pct(v, games).toFixed(1)}%</td><td>{ghost[i].toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
