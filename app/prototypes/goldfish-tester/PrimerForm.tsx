"use client";

// The guided primer: each question writes one GamePlan field. It starts from the auto-drafted plan,
// so a visitor corrects a reasonable draft instead of filling in a blank form.

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CARD_FLOW_ROLES, PICKABLE_ROLES, ROLE_LABELS } from "./config";
import { DEFAULT_PRIORITIES, describeRule, type PlanCore } from "./plan";
import { Segmented } from "./Segmented";
import type { PriorityRule, RoleKind } from "./types";
import type { Goldfish } from "./useGoldfish";
import { Select } from "./Select";
import { quietButton } from "./Window";

const ruleKey = (r: PriorityRule) => JSON.stringify(r.do === "dig" ? { do: "dig" } : r);

function Question({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-white/15 pt-3 first:border-t-0 first:pt-0">
      <legend className="mb-2 text-sm font-semibold"><span className="mr-1.5 tabular-nums text-amber-200">{n}.</span>{title}</legend>
      {children}
    </fieldset>
  );
}

function Chips({ roles, chosen, onToggle, ordered }: { roles: RoleKind[]; chosen: RoleKind[]; onToggle: (k: RoleKind) => void; ordered?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((k) => {
        const i = chosen.indexOf(k);
        return (
          <button key={k} type="button" aria-pressed={i >= 0} onClick={() => onToggle(k)} className={cn("min-h-11 rounded-full border px-3 text-sm transition-colors duration-150 ease-out", i >= 0 ? "border-white bg-white text-primary" : "border-white/40 text-white/75 hover:text-white")}>
            {ordered && i >= 0 ? `${i + 1}. ` : ""}{ROLE_LABELS[k]}
          </button>
        );
      })}
    </div>
  );
}

export function PrimerForm({ g, onWins }: { g: Goldfish; onWins: () => void }) {
  const { drafted } = g.composed;
  const plan: PlanCore = g.planCore ?? drafted;
  const update = (patch: Partial<PlanCore>) => g.setPlanCore({ ...plan, ...patch });
  const toggle = (list: RoleKind[], k: RoleKind) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);

  // Every rule the pilot knows, in the plan's order first, then the unused ones.
  const active = plan.priorities;
  const unused = DEFAULT_PRIORITIES.filter((r) => !active.some((a) => ruleKey(a) === ruleKey(r)));
  const move = (i: number, d: number) => {
    const next = [...active];
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r);
    update({ priorities: next });
  };
  const engine = plan.commander.engine?.length;
  const live = g.composed.wins.filter((w) => w.state === "counts");

  return (
    <div className="grid gap-4 pt-3">
      <p className="text-sm text-white/80">{g.planCore ? "Edited from the draft." : "Drafted from the deck's roles and win lines. Change anything that's wrong."}</p>

      <Question n={1} title="What makes an opening hand keepable?">
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs">At least this many lands
            <Select value={plan.mulligan.minLands} onChange={(e) => update({ mulligan: { ...plan.mulligan, minLands: Number(e.target.value) } })}>
              {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </label>
          <label className="grid gap-1 text-xs">At most this many lands
            <Select value={plan.mulligan.maxLands} onChange={(e) => update({ mulligan: { ...plan.mulligan, maxLands: Number(e.target.value) } })}>
              {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </label>
        </div>
        <p className="mb-1.5 mt-3 text-xs text-white/75">And it must show (mulligan otherwise, up to two times):</p>
        <Chips roles={PICKABLE_ROLES.filter((k) => k !== "land" && k !== "blank")} chosen={plan.mulligan.mustSee ?? []} onToggle={(k) => update({ mulligan: { ...plan.mulligan, mustSee: toggle(plan.mulligan.mustSee ?? [], k) } })} />
      </Question>

      <Question n={2} title="When do you cast your commander?">
        <Segmented label="Commander timing" value={plan.commander.castWhen} options={[{ value: "asap", label: "As soon as possible" }, { value: "afterRamp", label: "After mana rocks" }]} onChange={(castWhen) => update({ commander: { ...plan.commander, castWhen } })} />
        <p className="mt-2 text-xs text-white/70">
          {engine ? "Commander engine: each noncreature spell adds a counter and pings each opponent, Curiosity effects draw 3, and it taps for mana equal to its counters." : "No commander engine is modelled for this commander: it is cast, but has no triggers."}
        </p>
      </Question>

      <Question n={3} title="What does the deck do on turns 1 to 3?">
        <p className="mb-2 text-xs text-white/70">The pilot checks for a win, then takes the first rule that applies, top to bottom, until nothing does.</p>
        <ol className="grid gap-1.5">
          {active.map((r, i) => (
            <li key={ruleKey(r)} className="flex items-center gap-2 rounded-md bg-secondary/60 py-1 pl-3 pr-1 text-sm">
              <span className="tabular-nums text-white/60">{i + 1}</span>
              <span className="min-w-0 flex-1">{describeRule(r)}</span>
              <Button aria-label={`Move "${describeRule(r)}" up`} className={cn(quietButton, "w-11 px-0")} disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
              <Button aria-label={`Move "${describeRule(r)}" down`} className={cn(quietButton, "w-11 px-0")} disabled={i === active.length - 1} onClick={() => move(i, 1)}>↓</Button>
              <Button aria-label={`Turn off "${describeRule(r)}"`} className={cn(quietButton, "px-2")} onClick={() => update({ priorities: active.filter((_, j) => j !== i) })}>Off</Button>
            </li>
          ))}
        </ol>
        {unused.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unused.map((r) => <Button key={ruleKey(r)} className={quietButton} onClick={() => update({ priorities: [...active, r] })}>Add: {describeRule(r)}</Button>)}
          </div>
        )}
        {active.some((r) => r.do === "dig") && <p className="mt-2 text-xs text-white/60">Card flow means {CARD_FLOW_ROLES.map((k) => ROLE_LABELS[k].toLowerCase()).join(", ")}.</p>}
      </Question>

      <Question n={4} title="How do you win, and what's the backup?">
        <p className="text-sm text-white/80">{live.length ? live.map((w) => w.label).join(" · ") : "Nothing counts as a win yet."}</p>
        <Button className={cn(quietButton, "mt-2")} onClick={onWins}>Edit win conditions</Button>
      </Question>

      <Question n={5} title="What should dig spells and tutors look for?">
        <p className="mb-1.5 text-xs text-white/70">Missing combo pieces always come first. Then, in the order you tap them:</p>
        <Chips ordered roles={PICKABLE_ROLES.filter((k) => k !== "blank")} chosen={plan.lookFor} onToggle={(k) => update({ lookFor: toggle(plan.lookFor, k) })} />
      </Question>

      <Question n={6} title="Which turn are you aiming for?">
        <Select aria-label="Target turn" className="max-w-40" value={plan.targetTurn} onChange={(e) => update({ targetTurn: Number(e.target.value) })}>
          {[3, 4, 5, 6, 7, 8, 9, 10].map((t) => <option key={t} value={t}>Turn {t}</option>)}
        </Select>
      </Question>

      {g.planCore && <Button className={quietButton} onClick={() => g.setPlanCore(null)}>Go back to the drafted plan</Button>}
    </div>
  );
}
