"use client";

// App state: the deck and its resolution, fixes, win-condition choices, the plan, runs and sharing.
// Initial state is the baked Vivi demo, identical on server and client; browser state loads after mount.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, findCombos, importDeckUrl, resolveDeck } from "./api";
import type { Fix } from "./classify";
import { compose, demoCustomWins, isDemoText, resolveDemo, type Resolved, type Setup } from "./compose";
import { DEFAULT_SETTINGS } from "./config";
import { DEMO_DECK } from "./demoDeck";
import { parseDecklist } from "./parse";
import type { PlanCore } from "./plan";
import { decodeSetup, encodeSetup, type SharedSetup } from "./share";
import { loadFixes, loadLastDeck, saveFixes, saveLastDeck } from "./storage";
import type { DeckLine, GameResult, RunSettings, RunSummary, SpellbookCombo, WinCondition } from "./types";
import { useSimulator } from "./useSimulator";

export type LoadState = { status: "ready" } | { status: "loading"; message: string } | { status: "error"; message: string };
export type ComboState = { status: "idle" | "loading" | "ready" | "error"; combos: SpellbookCombo[]; almost: number; message?: string };
export type Results = { status: "idle" | "running" | "ready" | "error"; summary: RunSummary | null; signature: string | null; message?: string };
export type Sample = { status: "idle" | "loading" | "ready"; game: GameResult | null; offset: number };

const EMPTY_COMBOS: ComboState = { status: "idle", combos: [], almost: 0 };

function linesToText(lines: DeckLine[]): string {
  const part = (section: DeckLine["section"]) => lines.filter((l) => l.section === section).map((l) => `${l.qty} ${l.name}${l.set ? ` (${l.set.toUpperCase()})${l.collectorNumber ? ` ${l.collectorNumber}` : ""}` : ""}`);
  const commander = part("commander");
  return [...(commander.length ? ["Commander", ...commander, "", "Deck"] : []), ...part("deck")].join("\n");
}

export function useGoldfish() {
  const sim = useSimulator();
  const [deckText, setDeckText] = useState(DEMO_DECK);
  const [resolved, setResolved] = useState<Resolved>(resolveDemo);
  const [load, setLoad] = useState<LoadState>({ status: "ready" });
  const [fixes, setFixes] = useState<Record<string, Fix>>({});
  const [commanders, setCommanders] = useState<string[] | null>(null);
  const [combos, setCombos] = useState<ComboState>(EMPTY_COMBOS);
  const [custom, setCustom] = useState<WinCondition[]>(demoCustomWins);
  const [states, setStates] = useState<Record<string, WinCondition["state"]>>({});
  const [planCore, setPlanCore] = useState<PlanCore | null>(null);
  const [settings, setSettings] = useState<RunSettings>(DEFAULT_SETTINGS);
  const [results, setResults] = useState<Results>({ status: "idle", summary: null, signature: null });
  const [sample, setSample] = useState<Sample>({ status: "idle", game: null, offset: 0 });
  const [primer, setPrimer] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState(false);
  const loadRef = useRef<AbortController | null>(null);
  const comboRef = useRef<AbortController | null>(null);

  const setup: Setup = useMemo(() => ({ resolved, fixes, commanders, combos: combos.combos, custom, states, plan: planCore }), [resolved, fixes, commanders, combos.combos, custom, states, planCore]);
  const composed = useMemo(() => compose(setup), [setup]);
  const signature = useMemo(() => JSON.stringify([composed.plan, settings, composed.deck.sim.library.map((c) => `${c.oracleId}:${c.role.kind}:${c.cost}`), composed.deck.sim.commanders.map((c) => c.oracleId)]), [composed, settings]);
  const blocked = composed.deck.blocking > 0 || load.status === "loading";

  const fetchCombos = useCallback(async (r: Resolved, chosen: string[] | null) => {
    comboRef.current?.abort();
    const controller = new AbortController();
    comboRef.current = controller;
    const d = compose({ resolved: r, fixes: {}, commanders: chosen, combos: [], custom: [], states: {}, plan: null }).deck;
    const leads = d.commanders.map((c) => c.name);
    const main = [...new Set(d.entries.filter((e) => e.data && !e.commander).map((e) => e.data!.name))];
    if (!main.length) return;
    setCombos((prev) => ({ ...prev, status: "loading", message: undefined }));
    try {
      const res = await findCombos(leads, main, controller.signal);
      setCombos({ status: "ready", combos: res.included, almost: res.almostIncluded });
    } catch (error) {
      if (controller.signal.aborted) return;
      setCombos((prev) => ({ ...prev, status: "error", message: errorMessage(error) }));
    }
  }, []);

  type Keep = Partial<Pick<SharedSetup, "commanders" | "custom" | "states" | "plan" | "spellbook">>;

  /** Parses and resolves a list, resetting deck-specific choices unless `keep` restores them (shared links). */
  const loadDeck = useCallback(async (text: string, keep?: Keep, run = true) => {
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    const lines = parseDecklist(text);
    setDeckText(text);
    setSample({ status: "idle", game: null, offset: 0 });
    setCommanders(keep?.commanders ?? null);
    setStates(keep?.states ?? {});
    setPlanCore(keep?.plan ?? null);
    if (isDemoText(text)) {
      setResolved(resolveDemo());
      setCustom(keep?.custom ?? demoCustomWins());
      setLoad({ status: "ready" });
      setCombos(EMPTY_COMBOS);
      saveLastDeck(null);
      if (keep?.spellbook) void fetchCombos(resolveDemo(), keep.commanders ?? null);
      if (run) setPendingRun(true);
      return;
    }
    if (!lines.length) { setLoad({ status: "error", message: "No cards found in that list." }); return; }
    setCustom(keep?.custom ?? []);
    setCombos(EMPTY_COMBOS);
    setLoad({ status: "loading", message: `Looking up ${lines.length} cards…` });
    try {
      const res = await resolveDeck(lines, controller.signal);
      const r: Resolved = { lines, cards: res.cards, misses: res.misses };
      setResolved(r);
      setLoad({ status: "ready" });
      saveLastDeck(text);
      if (keep?.spellbook !== false) void fetchCombos(r, keep?.commanders ?? null);
      if (run) setPendingRun(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoad({ status: "error", message: errorMessage(error) });
    }
  }, [fetchCombos]);

  const importUrl = useCallback(async (url: string) => {
    setLoad({ status: "loading", message: "Importing deck…" });
    try {
      const res = await importDeckUrl(url);
      setPrimer(res.primer ?? null);
      await loadDeck(linesToText(res.lines));
    } catch (error) {
      setLoad({ status: "error", message: errorMessage(error) });
    }
  }, [loadDeck]);

  const runNow = useCallback(async () => {
    if (composed.deck.blocking > 0) return;
    const sig = signature;
    setResults((prev) => ({ ...prev, status: "running", message: undefined }));
    try {
      const summary = await sim.run(composed.deck.sim, composed.plan, settings);
      setResults({ status: "ready", summary, signature: sig });
    } catch (error) {
      setResults((prev) => ({ ...prev, status: "error", message: errorMessage(error) }));
    }
  }, [composed, settings, signature, sim]);

  // Runs queued by loads, resets and shared links fire once the deck is ready and combos have settled.
  useEffect(() => {
    if (!pendingRun || load.status !== "ready" || combos.status === "loading") return;
    const timer = window.setTimeout(() => { setPendingRun(false); void runNow(); }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingRun, load.status, combos.status, runNow]);

  // After mount: a shared link wins, then the last deck, then the demo.
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const saved = loadFixes();
      const shared = window.location.hash.length > 1 ? await decodeSetup(window.location.hash) : null;
      if (shared) {
        setFixes({ ...saved, ...shared.fixes });
        setSettings(shared.settings);
        await loadDeck(shared.deck, shared);
        return;
      }
      setFixes(saved);
      const last = loadLastDeck();
      if (last && !isDemoText(last)) await loadDeck(last);
      else setPendingRun(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDeck]);

  useEffect(() => () => { loadRef.current?.abort(); comboRef.current?.abort(); }, []);

  const dealSample = useCallback(async () => {
    if (composed.deck.blocking > 0) return;
    const offset = sample.offset + 1;
    setSample((prev) => ({ ...prev, status: "loading" }));
    try {
      const game = await sim.sample(composed.deck.sim, composed.plan, settings, offset);
      setSample({ status: "ready", game, offset });
    } catch {
      setSample((prev) => ({ ...prev, status: "idle" }));
    }
  }, [composed, settings, sample.offset, sim]);

  const setFix = useCallback((oracleId: string, fix: Fix | null) => {
    setFixes((prev) => {
      const next = { ...prev };
      if (fix) next[oracleId] = fix; else delete next[oracleId];
      saveFixes(next);
      return next;
    });
  }, []);

  /** Swaps a not-found line's name for a suggestion (or drops it) and resolves again. */
  const replaceCard = useCallback((query: string, replacement: string | null) => {
    const next = deckText.split("\n").flatMap((line) => {
      if (!line.includes(query)) return [line];
      return replacement ? [line.replace(query, replacement)] : [];
    }).join("\n");
    void loadDeck(next, { commanders, custom, states, plan: planCore }, false);
  }, [deckText, loadDeck, commanders, custom, states, planCore]);

  const chooseCommanders = useCallback((ids: string[]) => {
    setCommanders(ids);
    setPlanCore(null);
    void fetchCombos(resolved, ids);
  }, [fetchCombos, resolved]);

  const share = useCallback(async () => {
    try {
      const deckIds = new Set(composed.deck.entries.map((e) => e.data?.oracleId).filter(Boolean));
      const usedFixes = Object.fromEntries(Object.entries(fixes).filter(([id]) => deckIds.has(id)));
      const hash = await encodeSetup({ v: 1, deck: deckText, commanders, fixes: usedFixes, states, custom, plan: planCore, settings, spellbook: combos.status === "ready" });
      const url = new URL(window.location.href);
      url.hash = `s=${hash}`;
      window.history.replaceState(window.history.state, "", url);
      try {
        await navigator.clipboard.writeText(url.toString());
        setNotice("Link copied. It reproduces this exact run.");
      } catch {
        setNotice("Link is in the address bar. Copy it from there.");
      }
    } catch {
      setNotice("This browser can't build a share link.");
    }
  }, [composed.deck.entries, fixes, deckText, commanders, states, custom, planCore, settings, combos.status]);

  return {
    deckText, setDeckText, load, loadDeck, importUrl, primer,
    composed, fixes, setFix, replaceCard, commanders, chooseCommanders,
    combos, refetchCombos: () => fetchCombos(resolved, commanders),
    custom, setCustom, states, setStates,
    planCore, setPlanCore,
    settings, setSettings,
    results, stale: results.summary !== null && results.signature !== signature, blocked, runNow,
    sample, dealSample,
    share, notice, setNotice,
  };
}

export type Goldfish = ReturnType<typeof useGoldfish>;
