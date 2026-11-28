import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { field } from "./Window";

/**
 * A native select with its own chevron. Browsers place the built-in arrow differently (Safari ignores padding),
 * so it's hidden and drawn here with consistent right padding. `className` sizes the wrapper.
 */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select {...props} className={cn(field, "cursor-pointer appearance-none pr-10")}>{children}</select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" />
    </div>
  );
}
