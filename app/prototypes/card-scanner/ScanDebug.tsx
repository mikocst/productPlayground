"use client";

import type { IndexInfo, Engine } from "./scanEngine";

export type DebugStats = {
  ms: number;
  fps: number;
  best: string | null;
  distance: number | null;
  runnerUp: string | null;
  source: string;
  /** Detected quad in element pixels, for the outline overlay. */
  quad: [number, number][] | null;
  certain: string | null;
};

/** `?debug=1` readout over the camera: timing, throughput, the leading match, and the detected outline. */
export function ScanDebug({ stats, info, engine }: { stats: DebugStats | null; info: IndexInfo | null; engine: Engine }) {
  const built = info?.builtAt ? new Date(info.builtAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : null;
  return (
    <>
      {stats?.quad && (
        <svg aria-hidden className="pointer-events-none absolute inset-0 size-full">
          <polygon points={stats.quad.map(([x, y]) => `${x},${y}`).join(" ")} className="fill-none stroke-primary-bright" strokeWidth={2} />
        </svg>
      )}
      <dl className="absolute inset-x-3 top-3 grid grid-cols-[auto_1fr] gap-x-3 rounded-lg bg-card/90 p-2 font-mono text-[11px] leading-4">
        <dt className="text-muted-foreground">engine</dt>
        <dd className="truncate">
          {engine}
          {info ? ` · ${info.entries.toLocaleString()} entries` : ""}
          {info?.parseMs !== undefined ? ` · parsed ${info.parseMs.toFixed(0)} ms` : ""}
          {built ? ` · ${built}${info?.newestSet ? ` (${info.newestSet.toUpperCase()})` : ""}` : ""}
        </dd>
        <dt className="text-muted-foreground">frame</dt>
        <dd>{stats ? `${stats.ms.toFixed(1)} ms · ${stats.fps}/s` : "–"}</dd>
        <dt className="text-muted-foreground">best</dt>
        <dd className="truncate">{stats?.best ? `${stats.best} (${stats.distance})` : "–"}</dd>
        <dt className="text-muted-foreground">runner-up</dt>
        <dd className="truncate">{stats?.runnerUp ?? "–"}</dd>
        <dt className="text-muted-foreground">printing</dt>
        <dd className="truncate">{stats?.certain ?? "–"}</dd>
        <dt className="text-muted-foreground">quad</dt>
        <dd className="truncate">{stats?.source ?? "–"}</dd>
      </dl>
    </>
  );
}
