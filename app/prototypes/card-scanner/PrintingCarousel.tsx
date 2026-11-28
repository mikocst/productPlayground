"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { finishLabel, formatDate, rarityLabel } from "./scryfall";
import type { Printing } from "./types";

type Props = {
  printings: Printing[];
  index: number;
  truncated: boolean;
  onSelect: (index: number) => void;
};

const quiet = "border border-border bg-card text-foreground hover:bg-muted";

export function PrintingCarousel({ printings, index, truncated, onSelect }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const printing = printings[index];
  // The strip starts at the left and only scrolls when the selected set would be hidden, bringing it to
  // the left edge (never centering, never scrolling the page).
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!strip || !chip) return;
    const start = chip.offsetLeft - 4;
    const visible = chip.offsetLeft >= strip.scrollLeft && chip.offsetLeft + chip.offsetWidth <= strip.scrollLeft + strip.clientWidth;
    if (visible) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    strip.scrollTo({ left: Math.max(0, start), behavior: reduced ? "auto" : "smooth" });
  }, [index]);

  return (
    <section aria-label="Printings" className="space-y-4">
      <div className="flex items-center gap-2">
        <Button onClick={() => onSelect(index - 1)} disabled={index === 0} className={cn(quiet, "size-11 px-0")} aria-label="Previous printing">
          <ChevronLeft className="size-5" />
        </Button>
        <p className="flex-1 text-center text-sm tabular-nums text-muted-foreground" aria-live="polite">
          Printing {index + 1} of {printings.length}{truncated ? "+" : ""}
        </p>
        <Button onClick={() => onSelect(index + 1)} disabled={index === printings.length - 1} className={cn(quiet, "size-11 px-0")} aria-label="Next printing">
          <ChevronRight className="size-5" />
        </Button>
      </div>

      <div ref={stripRef} className="relative -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]" role="listbox" aria-label="Set index">
        {printings.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={i === index}
            data-index={i}
            title={`${item.setName} #${item.collectorNumber}`}
            onClick={() => onSelect(i)}
            className={cn(
              "min-h-11 shrink-0 rounded-lg border px-2.5 font-mono text-xs transition-colors duration-150 ease-out",
              i === index ? "border-primary bg-primary text-white" : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {item.set}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold leading-tight">{printing.setName}</h3>
        <p className="font-mono text-sm text-muted-foreground">{printing.set} · #{printing.collectorNumber}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge>{rarityLabel(printing.rarity)}</Badge>
          {printing.finishes.map((finish) => <Badge key={finish}>{finishLabel(finish)}</Badge>)}
          {printing.releasedAt && <Badge>{formatDate(printing.releasedAt)}</Badge>}
          {printing.lang !== "en" && <Badge>{printing.lang.toUpperCase()}</Badge>}
        </div>
      </div>
    </section>
  );
}
