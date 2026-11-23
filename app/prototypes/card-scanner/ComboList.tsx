"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { identityLabel, popularityLabel } from "./combos";
import { COMBO_PREVIEW } from "./data";
import type { Combo, ComboState } from "./types";

type Props = {
  state: ComboState;
  onExpand: () => void;
  onCollapse: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
};

const MotionLi = motion.create("li");
const quiet = "border border-border bg-card text-foreground hover:bg-muted";

function ComboItem({ combo }: { combo: Combo }) {
  const steps = combo.description.split("\n").map((line) => line.trim()).filter(Boolean);
  const popularity = popularityLabel(combo.popularity);
  return (
    <article className="space-y-3 rounded-xl border border-border bg-card p-4">
      <ul className="flex flex-wrap gap-2" aria-label="Cards in combo">
        {combo.cards.map((card, i) => (
          <li key={`${card.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-muted py-1 pl-1 pr-2.5 text-sm">
            {card.image ? (
              <Image src={card.image} alt="" width={28} height={39} unoptimized className="h-9.75 w-7 rounded-sm object-cover" />
            ) : null}
            <span>{card.name}</span>
          </li>
        ))}
      </ul>

      {combo.produces.length > 0 && (
        <div>
          <h4 className="text-xs text-muted-foreground">Results</h4>
          <ul className="mt-1 space-y-0.5 text-sm font-medium">
            {combo.produces.map((result) => <li key={result}>{result}</li>)}
          </ul>
        </div>
      )}

      {(combo.requires.length > 0 || combo.prerequisites.length > 0) && (
        <div>
          <h4 className="text-xs text-muted-foreground">Requires</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
            {[...combo.requires, ...combo.prerequisites].map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}
          </ul>
        </div>
      )}

      {steps.length > 0 && (
        <details className="group text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center text-primary-bright">Steps</summary>
          <ol className="list-decimal space-y-1 pl-5">
            {steps.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge>{identityLabel(combo.identity)}</Badge>
        <Badge>{combo.commanderLegal ? "Commander legal" : "Not Commander legal"}</Badge>
        {popularity && <Badge>{popularity}</Badge>}
        <a href={combo.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-11 items-center text-sm text-primary-bright underline-offset-4 hover:underline">
          Commander Spellbook
        </a>
      </div>
    </article>
  );
}

export function ComboList({ state, onExpand, onCollapse, onLoadMore, onRetry }: Props) {
  const visible = state.expanded ? state.items : state.items.slice(0, COMBO_PREVIEW);
  const loading = state.status === "loading";
  const canExpand = !state.expanded && (state.items.length > COMBO_PREVIEW || state.nextOffset !== null);

  return (
    <section aria-labelledby="combos-heading" aria-busy={loading} className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="combos-heading" className="text-lg font-semibold">Combos</h3>
        <p className="text-xs text-muted-foreground">Ranked by deck popularity</p>
      </div>

      {state.status === "error" && (
        <div role="alert" className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
          <p>{state.error}</p>
          <Button onClick={onRetry} className={quiet}>Retry combos</Button>
        </div>
      )}

      {loading && state.items.length === 0 && (
        <ul className="space-y-3" aria-label="Loading combos">
          {Array.from({ length: COMBO_PREVIEW }, (_, i) => (
            <li key={i} className="h-36 animate-pulse rounded-xl border border-border bg-muted motion-reduce:animate-none" />
          ))}
        </ul>
      )}

      {state.status === "ready" && state.items.length === 0 && (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Commander Spellbook lists no combos with this card.
        </p>
      )}

      {visible.length > 0 && (
        <ol className="space-y-3">
          <AnimatePresence initial={false}>
            {visible.map((combo) => (
              <MotionLi
                key={combo.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <ComboItem combo={combo} />
              </MotionLi>
            ))}
          </AnimatePresence>
        </ol>
      )}

      <div className="flex flex-wrap gap-2">
        {canExpand && <Button onClick={onExpand} disabled={loading}>Show all combos</Button>}
        {state.expanded && state.nextOffset !== null && (
          <Button onClick={onLoadMore} disabled={loading}>{loading ? "Loading…" : "Load more"}</Button>
        )}
        {state.expanded && state.items.length > COMBO_PREVIEW && (
          <Button onClick={onCollapse} className={quiet}>Show top {COMBO_PREVIEW}</Button>
        )}
      </div>
      {state.expanded && state.status === "ready" && state.nextOffset === null && state.items.length > 0 && (
        <p className="text-xs text-muted-foreground">All {state.items.length} combos shown.</p>
      )}
    </section>
  );
}
