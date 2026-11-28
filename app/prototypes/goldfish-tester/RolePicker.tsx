"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Fix } from "./classify";
import { PICKABLE_ROLES, ROLE_LABELS } from "./config";
import type { CardType, Role, RoleKind, SimCard } from "./types";
import { Select } from "./Select";
import { field, goldButton, quietButton } from "./Window";

const TUTOR_TYPES: CardType[] = ["instant", "sorcery", "artifact", "creature", "enchantment"];

function defaults(kind: RoleKind, current: Role): Role {
  if (current.kind === kind) return current;
  switch (kind) {
    case "land": return { kind, mana: 1 };
    case "rock": return { kind, mana: 1 };
    case "ritual": return { kind, adds: 3 };
    case "cantrip": return { kind, look: 1, take: 1 };
    case "drawEngine": return { kind, draws: 1 };
    case "tutor": return { kind, find: {} };
    case "burn": return { kind, damage: 3 };
    default: return { kind } as Role;
  }
}

function NumberField({ label, value, onChange, min = 0, max = 20 }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <label className="grid gap-1 text-xs">
      {label}
      <input type="number" min={min} max={max} className={field} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} />
    </label>
  );
}

/** Edits one card's role. The saved fix is keyed by oracle id, so it applies in every deck. */
export function RolePicker({ card, hasFix, onSave, onClear, onCancel }: { card: SimCard; hasFix: boolean; onSave: (fix: Fix) => void; onClear: () => void; onCancel: () => void }) {
  const [role, setRole] = useState<Role>(card.role);
  const [cost, setCost] = useState(card.cost);
  const set = (patch: Partial<Role>) => setRole((r) => ({ ...r, ...patch }) as Role);

  return (
    <div className="mt-2 grid gap-3 rounded-lg border border-white/30 bg-secondary/60 p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
        <label className="grid gap-1 text-xs">
          Role
          <Select value={role.kind} onChange={(e) => setRole(defaults(e.target.value as RoleKind, card.role))}>
            {[...new Set([...PICKABLE_ROLES, card.role.kind])].map((k) => <option key={k} value={k}>{ROLE_LABELS[k]}</option>)}
          </Select>
        </label>
        <NumberField label="Cost" value={cost} onChange={setCost} />
      </div>
      {(role.kind === "land" || role.kind === "rock") && <NumberField label="Mana it makes" value={role.mana} min={1} onChange={(mana) => set({ mana })} />}
      {role.kind === "ritual" && <NumberField label="Mana it adds" value={role.adds} min={1} onChange={(adds) => set({ adds })} />}
      {role.kind === "cantrip" && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Cards seen" value={role.look} min={1} onChange={(look) => set({ look })} />
          <NumberField label="Cards kept" value={role.take} min={1} onChange={(take) => set({ take })} />
        </div>
      )}
      {role.kind === "drawEngine" && <NumberField label="Cards a turn" value={role.draws} min={1} onChange={(draws) => set({ draws })} />}
      {role.kind === "burn" && <NumberField label="Damage" value={role.damage} min={1} onChange={(damage) => set({ damage })} />}
      {role.kind === "tutor" && (
        <fieldset className="grid gap-1 text-xs">
          <legend className="mb-1">Finds (none checked: any card)</legend>
          <div className="flex flex-wrap gap-x-3">
            {TUTOR_TYPES.map((t) => {
              const on = role.find.types?.includes(t) ?? false;
              return (
                <label key={t} className="inline-flex min-h-11 items-center gap-1.5 capitalize">
                  <input type="checkbox" className="h-4 w-4 accent-amber-400" checked={on} onChange={() => {
                    const types = on ? (role.find.types ?? []).filter((x) => x !== t) : [...(role.find.types ?? []), t];
                    set({ find: types.length ? { types } : {} });
                  }} />
                  {t}
                </label>
              );
            })}
            <label className="inline-flex min-h-11 items-center gap-1.5">
              <input type="checkbox" className="h-4 w-4 accent-amber-400" checked={!!role.toTop} onChange={() => set({ toTop: !role.toTop })} />
              puts it on top
            </label>
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        <Button className={goldButton} onClick={() => onSave({ role, cost })}>Save fix</Button>
        <Button className={quietButton} onClick={onCancel}>Cancel</Button>
        {hasFix && <Button className={quietButton} onClick={onClear}>Clear saved fix</Button>}
      </div>
    </div>
  );
}
