import type { TimerSettings } from "./types";

export const DEFAULT_SETTINGS: TimerSettings = { minutes: 25, breakMinutes: 5 };
export const STORAGE_KEY = "playground:focus-timer:settings";
