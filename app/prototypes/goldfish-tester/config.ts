import type { RoleKind, RunSettings } from "./types";

export const STORAGE_KEY = "goldfish-tester:v1";
export const FIXES_KEY = "goldfish-tester:fixes:v1";

export const OPPONENTS = 3;
export const STARTING_LIFE = 40;
export const MAX_MULLIGANS = 2;
/** Safety cap on pilot actions per turn. */
export const STEP_CAP = 90;
export const LIBRARY_SIZE = 99;

export const GAME_OPTIONS = [1000, 5000, 10000] as const;
export const TURN_CAPS = [10, 12] as const;
export const DEFAULT_SETTINGS: RunSettings = { games: 5000, seed: 1126, onPlay: true, turnCap: 10 };

export const ROLE_LABELS: Record<RoleKind, string> = {
  land: "Land",
  landcycler: "Landcycler",
  rock: "Mana rock",
  ritual: "Ritual",
  cantrip: "Cantrip / card selection",
  wheel: "Wheel",
  frantic: "Frantic Search",
  gush: "Gush",
  drawEngine: "Draw engine",
  amplifier: "Commander amplifier",
  tutor: "Tutor",
  burn: "Burn",
  blank: "Blank (never cast)",
};

/** Roles offered in the role picker. Frantic Search and Gush stay curated-only. */
export const PICKABLE_ROLES: RoleKind[] = ["land", "rock", "ritual", "cantrip", "wheel", "drawEngine", "amplifier", "tutor", "burn", "blank"];

/** Roles the dig rule casts for card flow, cheapest first. */
export const CARD_FLOW_ROLES: RoleKind[] = ["cantrip", "frantic", "gush", "ritual", "wheel", "burn"];
