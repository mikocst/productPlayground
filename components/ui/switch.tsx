"use client";

// AsterMotion Switch, adapted to a controlled API with role="switch" on a real button.
// Thumb and track both move at 0.15s easeOut (no spring: bounce reads as latency on a binary toggle).
// Track colours come from theme tokens via classes rather than animated hex values.

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const MotionSpan = motion.create("span");

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  /** Track classes for each state, so the switch keeps its contrast on dark surfaces. */
  onClassName?: string;
  offClassName?: string;
};

export function Switch({ checked, onCheckedChange, children, className, disabled, onClassName = "bg-primary-darker", offClassName = "bg-border" }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-sm disabled:opacity-50", className)}
    >
      <span className={cn("relative flex h-5 w-10 shrink-0 items-center rounded-full p-1 transition-colors duration-150 ease-out", checked ? onClassName : offClassName)}>
        <MotionSpan
          initial={false}
          animate={{ translateX: checked ? 20 : 0 }}
          transition={{ ease: "easeOut", duration: 0.15 }}
          className="absolute left-0 h-5 w-5 rounded-full bg-white shadow-sm"
        />
      </span>
      {children}
    </button>
  );
}
