"use client";

import { cn } from "@/lib/utils";
import { storeOffers } from "./scryfall";
import type { CardKingdomResponse, Printing } from "./types";

type Props = {
  printing: Printing;
  cardKingdom: CardKingdomResponse | null;
  cardKingdomStatus: "loading" | "ready" | "error";
};

const tile = "flex min-h-11 flex-col gap-1 rounded-xl border border-border bg-card p-3 text-left";

/** One button per store with that store's prices for the selected printing. */
export function StorePrices({ printing, cardKingdom, cardKingdomStatus }: Props) {
  const offers = storeOffers(printing, cardKingdom);
  const ckTime = cardKingdom?.updatedAt ? new Date(cardKingdom.updatedAt.replace(" ", "T")) : null;

  return (
    <section aria-labelledby="prices-heading" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="prices-heading" className="text-lg font-semibold">Prices</h2>
        <p className="truncate text-xs text-muted-foreground">{printing.setName} · #{printing.collectorNumber}</p>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {offers.map((offer) => {
          const pending = offer.store === "Card Kingdom" && cardKingdomStatus === "loading";
          const failed = offer.store === "Card Kingdom" && cardKingdomStatus === "error";
          const body = (
            <>
              <span className="text-sm font-medium">{offer.store}</span>
              {pending ? (
                <span className="text-sm text-muted-foreground">Loading…</span>
              ) : failed ? (
                <span className="text-sm text-muted-foreground">Unavailable</span>
              ) : offer.rows.length ? (
                offer.rows.map((row) => (
                  <span key={row.label} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-semibold tabular-nums">{row.value}</span>
                  </span>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">Not listed</span>
              )}
            </>
          );
          return (
            <li key={offer.store}>
              {offer.url ? (
                <a
                  href={offer.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${offer.store}: open this printing in a new tab`}
                  className={cn(tile, "h-full transition-colors duration-150 ease-out hover:bg-muted")}
                >
                  {body}
                </a>
              ) : (
                <div className={cn(tile, "h-full")}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        TCGplayer, Cardmarket, and Cardhoarder prices via Scryfall, updated daily. Card Kingdom from its price list
        {ckTime && !Number.isNaN(ckTime.getTime()) ? `, ${ckTime.toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}. Not live quotes.
      </p>
    </section>
  );
}
