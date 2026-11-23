"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { finishLabel, formatDate, priceRows, rarityLabel } from "./scryfall";
import type { Printing } from "./types";

type Props = {
  printings: Printing[];
  index: number;
  fetchedAt: string;
  truncated: boolean;
  onSelect: (index: number) => void;
};

const quiet = "border border-border bg-card text-foreground hover:bg-muted";
const link = "inline-flex min-h-11 items-center text-sm text-primary-bright underline-offset-4 hover:underline";

export function PrintingCarousel({ printings, index, fetchedAt, truncated, onSelect }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const printing = printings[index];
  const rows = priceRows(printing.prices);
  const fetched = new Date(fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  // Keep the selected set chip visible without scrolling the page vertically.
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!strip || !chip) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    strip.scrollTo({ left: chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2, behavior: reduced ? "auto" : "smooth" });
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

      <div ref={stripRef} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]" role="listbox" aria-label="Set index">
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
        <h2 className="text-lg font-semibold leading-tight">{printing.setName}</h2>
        <p className="font-mono text-sm text-muted-foreground">{printing.set} · #{printing.collectorNumber}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge>{rarityLabel(printing.rarity)}</Badge>
          {printing.finishes.map((finish) => <Badge key={finish}>{finishLabel(finish)}</Badge>)}
          {printing.releasedAt && <Badge>{formatDate(printing.releasedAt)}</Badge>}
          {printing.lang !== "en" && <Badge>{printing.lang.toUpperCase()}</Badge>}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        {rows.length ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {rows.map((row) => (
              <div key={row.label} className="flex flex-col">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="font-semibold tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">No price data for this printing.</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Scryfall daily prices, fetched {fetched}. Not a live marketplace quote.
        </p>
      </div>

      <div className="flex flex-wrap gap-x-4">
        <a href={printing.scryfallUrl} target="_blank" rel="noopener noreferrer" className={link}>View on Scryfall</a>
        {printing.purchaseLinks.map((item) => (
          <a key={item.label} href={item.url} target="_blank" rel="noopener noreferrer" className={link}>{item.label}</a>
        ))}
      </div>
    </section>
  );
}
