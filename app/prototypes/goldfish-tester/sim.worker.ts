// Simulation worker: thousands of games stay off the UI thread. Created by useSimulator.ts.

import { runMany, sampleGame } from "./runner";
import type { WorkerRequest, WorkerResponse } from "./types";

type Scope = { onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null; postMessage(message: WorkerResponse): void };
const scope = self as unknown as Scope;

scope.onmessage = (event) => {
  const req = event.data;
  try {
    if (req.type === "run") scope.postMessage({ type: "run", id: req.id, summary: runMany(req.deck, req.plan, req.settings) });
    else scope.postMessage({ type: "sample", id: req.id, game: sampleGame(req.deck, req.plan, req.settings, req.offset) });
  } catch (error) {
    scope.postMessage({ type: "error", id: req.id, message: error instanceof Error ? error.message : "The simulation failed." });
  }
};
