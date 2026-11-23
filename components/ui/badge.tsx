import type { ReactNode } from "react";

export function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground ${className}`}>{children}</span>;
}
