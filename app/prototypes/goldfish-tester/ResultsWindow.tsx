"use client";

import { Histogram } from "./Histogram";
import { RunControls } from "./RunControls";
import type { Goldfish } from "./useGoldfish";
import { Window } from "./Window";

function Tile({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/40 bg-secondary/50 px-3 py-2">
      <b className={`block text-2xl font-bold tabular-nums sm:text-3xl ${tone ?? ""}`}>{value}</b>
      <span className="text-xs text-white/70">{label}</span>
    </div>
  );
}

export function ResultsWindow({ g }: { g: Goldfish }) {
  const { results, composed, stale } = g;
  const s = results.summary;
  const target = composed.plan.targetTurn;
  return (
    <Window title="Executed turn" id="gf-results">
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_12.5rem]">
        <div className="min-w-0" aria-busy={results.status === "running"}>
          {s ? (
            <>
              <div className="mb-4 grid grid-cols-2 gap-2">
                <Tile value={s.medianExecuted ? `T${s.medianExecuted}` : "—"} label="Median executed turn" />
                <Tile value={`${(100 * s.wonByTarget).toFixed(0)}%`} label={`Won by turn ${target}`} />
              </div>
              {s.meanGap !== null && (
                <p className="mb-3 text-sm text-white/80">
                  Pieces assembled ~{s.meanGap.toFixed(1)} turns before the win on average{s.meanGap >= 0.5 ? ", so mana is the bottleneck more often than pieces." : "."}
                </p>
              )}
              <Histogram summary={s} target={target} />
              {stale && <p className="mt-3 text-sm text-amber-200">The setup changed since this run. Run again to update.</p>}
            </>
          ) : (
            <div className="grid h-64 place-items-center rounded-lg border border-dashed border-white/40 text-sm text-white/70">
              {results.status === "error" ? results.message : "Simulating the demo deck…"}
            </div>
          )}
          {results.status === "error" && s && <p className="mt-2 text-sm text-rose-200">{results.message}</p>}
        </div>
        <RunControls g={g} />
      </div>
    </Window>
  );
}
