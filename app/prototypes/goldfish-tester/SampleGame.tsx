"use client";

// One logged game, played back a turn at a time. Assembly is a quiet beat that names the shortfall;
// execution is the climax: a gold line the log scrolls to. Reduced motion shows the whole game at once.

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LogLine } from "./types";
import type { Goldfish } from "./useGoldfish";
import { quietButton, Window } from "./Window";

const MotionDiv = motion.create("div");
const TURN_MS = 900;

function groupByTurn(log: LogLine[]): LogLine[][] {
  const groups: LogLine[][] = [[]];
  for (const line of log) {
    if (line.tone === "turn") groups.push([line]);
    else groups[groups.length - 1].push(line);
  }
  return groups.filter((g) => g.length);
}

function Playback({ log }: { log: LogLine[] }) {
  const reduce = useReducedMotion();
  const groups = useMemo(() => groupByTurn(log), [log]);
  const [shown, setShown] = useState(1);
  const boxRef = useRef<HTMLDivElement>(null);
  const visible = reduce ? groups.length : shown;
  const done = visible >= groups.length;

  useEffect(() => {
    if (reduce || done) return;
    const t = window.setTimeout(() => setShown((n) => n + 1), TURN_MS);
    return () => window.clearTimeout(t);
  }, [reduce, done, shown]);

  // Follow the newest turn; once finished, land on the winning (or final) line.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const target = done ? box.querySelector<HTMLElement>("[data-executed]") : [...box.querySelectorAll<HTMLElement>("[data-turn-group]")].at(-1) ?? null;
    if (target) box.scrollTo({ top: Math.max(0, target.offsetTop - box.offsetTop - 24), behavior: reduce ? "auto" : "smooth" });
  }, [visible, done, reduce]);

  // On desktop the log is absolutely filled into its bento cell, so it adds no height of its own and scrolls instead.
  return (
    <div className="relative mt-3 min-h-52 flex-1">
      <div ref={boxRef} className="max-h-96 overflow-auto rounded-lg bg-secondary/70 px-3 py-2.5 text-sm lg:absolute lg:inset-0 lg:max-h-none" aria-live="polite">
        {groups.slice(0, visible).map((group, gi) => (
          <MotionDiv key={gi} data-turn-group="" initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
            {group.map((line, li) => (
              <p
                key={li}
                {...(line.tone === "executed" ? { "data-executed": "" } : {})}
                className={cn(
                  "mb-1",
                  line.tone === "turn" && "mt-2 font-bold text-white",
                  line.tone === "assembled" && "italic text-white/75",
                  line.tone === "executed" && "my-2 border-l-4 border-amber-400 pl-2 font-bold text-amber-200",
                  line.tone === "commander" && "font-semibold",
                  !line.tone && "text-white/85",
                )}
              >
                {line.text}
              </p>
            ))}
          </MotionDiv>
        ))}
        {!done && (
          <div className="sticky bottom-0 flex justify-end pt-2">
            <Button className={cn(quietButton, "bg-secondary")} onClick={() => setShown(groups.length)}>Skip to the end</Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function SampleGame({ g }: { g: Goldfish }) {
  const { sample } = g;
  return (
    <Window
      title="Watch one game"
      id="gf-sample"
      className="flex flex-col"
      action={<Button className={quietButton} disabled={g.blocked || sample.status === "loading"} onClick={() => void g.dealSample()}>{sample.game ? "Deal another" : "Deal a sample game"}</Button>}
    >
      {sample.game?.log ? <Playback key={sample.offset} log={sample.game.log} /> : (
        <p className="text-sm text-white/70">Plays one seeded game turn by turn: land drops, casts, when the pieces came together and how it won.</p>
      )}
    </Window>
  );
}
