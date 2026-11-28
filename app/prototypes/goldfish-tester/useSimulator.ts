"use client";

// Owns the simulation worker. Each call gets an id; only the latest run's answer is kept.

import { useCallback, useEffect, useRef } from "react";
import type { GamePlan, GameResult, RunSettings, RunSummary, SimDeck, WorkerRequest, WorkerResponse } from "./types";

type Pending = { resolve: (value: RunSummary | GameResult) => void; reject: (error: Error) => void };

export function useSimulator() {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);

  const worker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const created = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    created.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const p = pending.current.get(msg.id);
      if (!p) return;
      pending.current.delete(msg.id);
      if (msg.type === "error") p.reject(new Error(msg.message));
      else p.resolve(msg.type === "run" ? msg.summary : msg.game);
    };
    created.onerror = () => {
      for (const p of pending.current.values()) p.reject(new Error("The simulation worker stopped."));
      pending.current.clear();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    workerRef.current = created;
    return created;
  }, []);

  const send = useCallback(<T extends RunSummary | GameResult>(req: Omit<WorkerRequest, "id"> & { offset?: number }): Promise<T> => {
    const id = nextId.current++;
    return new Promise<T>((resolve, reject) => {
      pending.current.set(id, { resolve: resolve as Pending["resolve"], reject });
      worker().postMessage({ ...req, id } as WorkerRequest);
    });
  }, [worker]);

  const run = useCallback((deck: SimDeck, plan: GamePlan, settings: RunSettings) => send<RunSummary>({ type: "run", deck, plan, settings }), [send]);
  const sample = useCallback((deck: SimDeck, plan: GamePlan, settings: RunSettings, offset: number) => send<GameResult>({ type: "sample", deck, plan, settings, offset }), [send]);

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null; }, []);
  return { run, sample };
}
