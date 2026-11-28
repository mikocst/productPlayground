"use client";

// AsterMotion Tabs, adapted: controlled-with-fallback value, real tab buttons with arrow-key navigation,
// and a per-instance layoutId. The pill slides at 0.3s easeInOut; content crossfades at 0.2s easeOut.

import { AnimatePresence, motion } from "motion/react";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const MotionDiv = motion.create("div");

export type TabItem = { id: string; title: string; content: ReactNode };

type TabsProps = {
  tabs: TabItem[];
  value?: string;
  onValueChange?: (id: string) => void;
  /** Classes for the pill and labels, so the tabs sit on any surface. */
  pillClassName?: string;
  activeClassName?: string;
  idleClassName?: string;
  className?: string;
};

export function Tabs({ tabs, value, onValueChange, pillClassName = "bg-primary", activeClassName = "text-white font-medium", idleClassName = "text-muted-foreground hover:font-medium", className }: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(tabs[0]?.id ?? "");
  const active = value ?? internal;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (id: string) => { setInternal(id); onValueChange?.(id); };
  const index = Math.max(0, tabs.findIndex((t) => t.id === active));

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    select(tabs[next].id);
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div role="tablist" className="relative flex flex-row gap-2 overflow-x-auto border-b border-current/20 py-2">
        {tabs.map((tab, i) => {
          const on = i === index;
          return (
            <button
              key={tab.id}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={on}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => select(tab.id)}
              onKeyDown={(e) => onKey(e, i)}
              className="relative z-20 flex min-h-11 shrink-0 cursor-pointer flex-col justify-center"
            >
              {on && (
                <MotionDiv layoutId={`${baseId}-pill`} layout transition={{ ease: "easeInOut", duration: 0.3 }} className={cn("absolute inset-0 z-10 rounded-md", pillClassName)} />
              )}
              <span className={cn("relative z-20 whitespace-nowrap px-3", on ? activeClassName : idleClassName)}>{tab.title}</span>
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait">
        {tabs[index] && (
          <MotionDiv
            key={tabs[index].id}
            role="tabpanel"
            id={`${baseId}-panel-${tabs[index].id}`}
            aria-labelledby={`${baseId}-tab-${tabs[index].id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {tabs[index].content}
          </MotionDiv>
        )}
      </AnimatePresence>
    </div>
  );
}
