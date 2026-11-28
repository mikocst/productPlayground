import type { Goldfish } from "./useGoldfish";
import { Window } from "./Window";

export function LinesWindow({ g }: { g: Goldfish }) {
  const s = g.results.summary;
  const total = s ? s.lines.reduce((a, l) => a + l.count, 0) : 0;
  return (
    <Window title="Which line won" id="gf-lines">
      {!s ? <p className="text-sm text-white/70">Run a simulation to see which win conditions close games.</p> : !s.lines.length ? <p className="text-sm text-white/70">No wins recorded by turn {s.turnCap}.</p> : (
        <ul className="grid gap-2.5">
          {s.lines.map((l) => (
            <li key={l.label} className="grid grid-cols-[minmax(6rem,10rem)_minmax(0,1fr)_3rem] items-center gap-2.5 text-sm">
              <span className="truncate" title={l.label}>{l.label}</span>
              <span className="h-3 overflow-hidden rounded-full bg-secondary/70"><span className="block h-full rounded-full bg-amber-600" style={{ width: `${(100 * l.count) / total}%` }} /></span>
              <b className="text-right tabular-nums">{((100 * l.count) / total).toFixed(0)}%</b>
            </li>
          ))}
        </ul>
      )}
      {s && (
        <p className="mt-3 text-xs text-white/70">
          {s.meanCommanderTurn ? `Commander lands on turn ${s.meanCommanderTurn.toFixed(1)} on average. ` : ""}
          {(100 * s.mulliganShare).toFixed(0)}% of games mulliganed. {s.games.toLocaleString()} games, {s.onPlay ? "on the play" : "on the draw"}.
        </p>
      )}
    </Window>
  );
}
