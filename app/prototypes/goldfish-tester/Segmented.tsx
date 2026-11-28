import { cn } from "@/lib/utils";

/** Two-to-four way choice as pressed buttons, like the Vivi sim's turn-order toggle. */
export function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn("min-h-11 rounded-md border border-white/40 px-2 text-sm font-medium transition-colors duration-150 ease-out", o.value === value ? "bg-white text-primary" : "bg-secondary/70 text-white/75 hover:text-white")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
