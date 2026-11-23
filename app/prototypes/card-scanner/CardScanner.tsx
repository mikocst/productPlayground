"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CameraScanner } from "./CameraScanner";
import { CardViewport } from "./CardViewport";
import { ComboList } from "./ComboList";
import { fetchCombos } from "./combos";
import { COMBO_PAGE, COMBO_PREVIEW, EMPTY_COMBOS } from "./data";
import { ManualSearch } from "./ManualSearch";
import { PrintingCarousel } from "./PrintingCarousel";
import { RecognitionStatus } from "./RecognitionStatus";
import { errorMessage, fetchCard, fetchCardKingdom, recognizeName } from "./scryfall";
import { StorePrices } from "./StorePrices";
import type { ArtCandidate, CardIdentity, CardKingdomState, CardState, ComboState, Recognition } from "./types";

const quiet = "border border-border bg-card text-foreground hover:bg-muted";
const link = "text-primary-bright underline-offset-4 hover:underline";

function writeUrl(oracleId: string | null, printId: string | null) {
  try {
    const url = new URL(window.location.href);
    url.search = "";
    if (oracleId) url.searchParams.set("card", oracleId);
    if (oracleId && printId) url.searchParams.set("print", printId);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // URL state is a convenience; ignore failures.
  }
}

export function CardScanner() {
  const [recognition, setRecognition] = useState<Recognition>({ phase: "idle" });
  const [card, setCard] = useState<CardState>({ status: "empty" });
  const [printIndex, setPrintIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [combos, setCombos] = useState<ComboState>(EMPTY_COMBOS);
  const [cardKingdom, setCardKingdom] = useState<CardKingdomState | null>(null);
  const lookupRef = useRef<AbortController | null>(null);
  const cardRef = useRef<AbortController | null>(null);
  const comboRef = useRef<AbortController | null>(null);

  const loadCombos = useCallback(async (oracleId: string, offset: number, limit: number, expanded: boolean) => {
    comboRef.current?.abort();
    const controller = new AbortController();
    comboRef.current = controller;
    setCombos((prev) => ({
      ...(prev.oracleId === oracleId ? prev : EMPTY_COMBOS),
      oracleId,
      expanded,
      status: "loading",
      error: null,
    }));
    try {
      const page = await fetchCombos(oracleId, offset, limit, controller.signal);
      setCombos((prev) => {
        const known = offset === 0 ? [] : prev.items;
        const ids = new Set(known.map((combo) => combo.id));
        return {
          ...prev,
          items: [...known, ...page.combos.filter((combo) => !ids.has(combo.id))],
          nextOffset: page.nextOffset,
          status: "ready",
        };
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setCombos((prev) => ({ ...prev, status: "error", error: errorMessage(error) }));
    }
  }, []);

  const openCard = useCallback(async (oracleId: string, printId: string | null = null, name?: string) => {
    lookupRef.current?.abort();
    cardRef.current?.abort();
    const controller = new AbortController();
    cardRef.current = controller;
    setRecognition({ phase: "idle" });
    setCard({ status: "loading", name });
    setCombos(EMPTY_COMBOS);
    try {
      const data = await fetchCard(oracleId, controller.signal);
      const index = Math.max(0, data.printings.findIndex((p) => p.id === printId));
      setCard({ status: "ready", data });
      setPrintIndex(index);
      writeUrl(data.card.oracleId, data.printings[index]?.id ?? null);
      loadCombos(data.card.oracleId, 0, COMBO_PREVIEW, false);
    } catch (error) {
      if (controller.signal.aborted) return;
      setCard({ status: "error", message: errorMessage(error), oracleId });
    }
  }, [loadCombos]);

  /** Resolves a typed (or chosen) card name and opens the best match. */
  const resolveName = useCallback(async (name: string) => {
    lookupRef.current?.abort();
    const controller = new AbortController();
    lookupRef.current = controller;
    setRecognition({ phase: "resolving", query: name });
    try {
      const result = await recognizeName([name], controller.signal);
      if (result.status === "no-match") setRecognition({ phase: "no-match", read: name, suggestions: result.suggestions });
      else openCard(result.card.oracleId, null, result.card.name);
    } catch (error) {
      if (controller.signal.aborted) return;
      setRecognition({ phase: "error", message: errorMessage(error) });
    }
  }, [openCard]);

  // Auto-scan callbacks (the camera loop decides; these only present the decision).
  const scanOpen = useCallback((match: ArtCandidate) => openCard(match.oracleId, match.printingId, match.name), [openCard]);
  const scanConfirm = useCallback((match: ArtCandidate, others: string[]) => setRecognition({
    phase: "confirm",
    card: { oracleId: match.oracleId, name: match.name, layout: "", typeLine: "" },
    printId: match.printingId,
    read: "",
    suggestions: others,
  }), []);
  const scanMiss = useCallback((others: string[]) => setRecognition({ phase: "no-match", read: "", suggestions: others }), []);
  const scanFailed = useCallback((message: string) => setRecognition({ phase: "error", message }), []);
  const scanReading = useCallback(() => setRecognition({ phase: "reading" }), []);

  // Deep links: ?card=<oracle id>&print=<scryfall id>. Read after mount so server and first client render match.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oracleId = params.get("card");
    if (!oracleId) return;
    const timer = window.setTimeout(() => openCard(oracleId, params.get("print")), 0);
    return () => window.clearTimeout(timer);
  }, [openCard]);

  // Card Kingdom prices for the selected printing. Results are keyed by printing id, so a slow response
  // never shows under a different printing and "loading" is simply "no result for this printing yet".
  const selectedPrintingId = card.status === "ready" ? card.data.printings[printIndex]?.id ?? null : null;
  useEffect(() => {
    if (!selectedPrintingId) return;
    const controller = new AbortController();
    fetchCardKingdom(selectedPrintingId, controller.signal)
      .then((data) => setCardKingdom({ printingId: selectedPrintingId, status: "ready", data }))
      .catch(() => { if (!controller.signal.aborted) setCardKingdom({ printingId: selectedPrintingId, status: "error" }); });
    return () => controller.abort();
  }, [selectedPrintingId]);

  useEffect(() => () => {
    lookupRef.current?.abort();
    cardRef.current?.abort();
    comboRef.current?.abort();
  }, []);

  function selectPrinting(next: number) {
    if (card.status !== "ready") return;
    const total = card.data.printings.length;
    if (next < 0 || next >= total || next === printIndex) return;
    setDirection(next > printIndex ? 1 : -1);
    setPrintIndex(next);
    writeUrl(card.data.card.oracleId, card.data.printings[next].id);
  }

  function scanAnother() {
    lookupRef.current?.abort();
    cardRef.current?.abort();
    comboRef.current?.abort();
    setCard({ status: "empty" });
    setCombos(EMPTY_COMBOS);
    setRecognition({ phase: "idle" });
    writeUrl(null, null);
  }

  const busy = recognition.phase === "reading" || recognition.phase === "resolving";
  const oracleId = card.status === "ready" ? card.data.card.oracleId : null;
  const ckForSelection = cardKingdom && cardKingdom.printingId === selectedPrintingId ? cardKingdom : null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-5 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Card Scanner</h1>
        {card.status !== "empty" && <Button onClick={scanAnother} className="px-6">Scan</Button>}
      </header>

      {card.status === "empty" && (
        <div className="space-y-4">
          <CameraScanner
            paused={recognition.phase !== "idle"}
            onReading={scanReading}
            onOpen={scanOpen}
            onConfirm={scanConfirm}
            onMiss={scanMiss}
            onFailure={scanFailed}
          />
          <RecognitionStatus
            recognition={recognition}
            onOpen={(identity: CardIdentity, printId: string | null) => openCard(identity.oracleId, printId, identity.name)}
            onChoose={resolveName}
            onDismiss={() => setRecognition({ phase: "idle" })}
          />
          <ManualSearch disabled={busy} onSearch={resolveName} />
        </div>
      )}

      {card.status === "loading" && (
        <div className="grid gap-6 sm:grid-cols-2" aria-busy="true">
          <div className="mx-auto aspect-63/88 w-full max-w-[18rem] animate-pulse rounded-[4.75%/3.4%] bg-muted motion-reduce:animate-none" />
          <p role="status" className="text-sm text-muted-foreground">Loading {card.name ?? "card"} printings…</p>
        </div>
      )}

      {card.status === "error" && (
        <div role="alert" className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
          <p>{card.message}</p>
          <div className="flex gap-2 whitespace-nowrap">
            <Button onClick={() => openCard(card.oracleId)}>Retry</Button>
            <Button onClick={scanAnother} className={quiet}>Back to scanner</Button>
          </div>
        </div>
      )}

      {card.status === "ready" && (
        <>
          <div>
            <p className="text-sm text-muted-foreground">{card.data.card.typeLine}</p>
            <p className="text-2xl font-semibold leading-tight">{card.data.card.name}</p>
          </div>
          <StorePrices
            printing={card.data.printings[printIndex]}
            cardKingdom={ckForSelection?.status === "ready" ? ckForSelection.data : null}
            cardKingdomStatus={ckForSelection?.status ?? "loading"}
          />
          <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2">
            <div className="min-w-0 sm:sticky sm:top-6">
              <CardViewport
                printing={card.data.printings[printIndex]}
                cardName={card.data.card.name}
                direction={direction}
                onPrev={() => selectPrinting(printIndex - 1)}
                onNext={() => selectPrinting(printIndex + 1)}
              />
            </div>
            <div className="min-w-0">
              <PrintingCarousel
                printings={card.data.printings}
                index={printIndex}
                truncated={card.data.truncated}
                onSelect={selectPrinting}
              />
            </div>
          </div>
          {oracleId && (
            <ComboList
              state={combos}
              onExpand={() => {
                if (combos.nextOffset === null) setCombos((prev) => ({ ...prev, expanded: true }));
                else loadCombos(oracleId, combos.nextOffset, COMBO_PAGE, true);
              }}
              onLoadMore={() => combos.nextOffset !== null && loadCombos(oracleId, combos.nextOffset, COMBO_PAGE, true)}
              onCollapse={() => setCombos((prev) => ({ ...prev, expanded: false }))}
              onRetry={() => combos.items.length === 0
                ? loadCombos(oracleId, 0, COMBO_PREVIEW, false)
                : loadCombos(oracleId, combos.nextOffset ?? 0, COMBO_PAGE, true)}
            />
          )}
        </>
      )}

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        Card data, images, and TCGplayer, Cardmarket, and Cardhoarder prices from <a className={link} href="https://scryfall.com" target="_blank" rel="noopener noreferrer">Scryfall</a>.
        Card Kingdom prices from <a className={link} href="https://www.cardkingdom.com" target="_blank" rel="noopener noreferrer">Card Kingdom</a>.
        Combos from <a className={link} href="https://commanderspellbook.com" target="_blank" rel="noopener noreferrer">Commander Spellbook</a>.
        Magic: The Gathering card names and art © Wizards of the Coast. This prototype is not affiliated with or endorsed by them.
      </footer>
    </main>
  );
}
