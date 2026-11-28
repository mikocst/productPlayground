import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The Final Fantasy menu window from the Vivi sim, built from theme tokens: deep blue gradient, bright border. */
export function Window({ title, id, children, className, action }: { title: string; id: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section aria-labelledby={id} className={cn("h-full rounded-xl border-2 border-white/90 bg-linear-to-b from-primary to-secondary p-4 text-white shadow-lg ring-2 ring-inset ring-secondary/60 sm:p-5", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export const field = "min-h-11 w-full rounded-md border border-white/40 bg-secondary/70 px-3 text-base text-white placeholder:text-white/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400";
export const quietButton = "border border-white/50 bg-transparent text-white hover:bg-white/10";
export const goldButton = "border-2 border-white bg-amber-400 font-semibold text-secondary hover:bg-amber-300";
export const dim = "text-white/70";
