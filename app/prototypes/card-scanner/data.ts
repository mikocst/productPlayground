import type { ComboState } from "./types";

export const API_BASE = "/api/card-scanner";

/** Combos shown before "Show all". */
export const COMBO_PREVIEW = 3;
/** Page size when the full combo list is expanded. */
export const COMBO_PAGE = 20;

/** Physical MTG card ratio (63 × 88 mm). */
export const CARD_RATIO = 63 / 88;

/** Guide frame height as a fraction of the camera viewport height. */
export const FRAME_HEIGHT = 0.86;

/** Tilt limits in degrees. */
export const DRAG_TILT = 22;
export const HOVER_TILT = 8;
export const GYRO_TILT = 14;
/** Horizontal drag distance (px) that switches printings on release. */
export const SWIPE_DISTANCE = 80;

export const TILT_SPRING = { stiffness: 300, damping: 30 };

/** Perceptual-hash index of every unique paper artwork on Scryfall (scripts/build-card-art-index.ts). */
export const ART_INDEX_URL = "/data/mtg-art-index.json";

/** Auto-scan: how often the live frame is sampled. */
export const AUTO_TICK_MS = 160;
/** Mean frame change (0–255, smoothed) above which the card is being moved, not held. Tremor stays below. */
export const MOVING_DIFF = 22;
/** A frame must be at least this sharp relative to the sharpest recent frame (skips motion blur). */
export const SHARPNESS_RATIO = 0.7;

/** The art area must have at least this much contrast (std dev, 0–255) to be worth matching; an empty table measures ~4–6. */
export const MIN_TEXTURE = 10;

/**
 * The card is rarely exactly on the guide. Each frame is hashed on a coarse grid of card sizes (fraction of
 * the guide) and center offsets (fraction of the guide size), then refined around the best placement with
 * smaller steps and slight tilts (degrees).
 */
export const CARD_SCALES = [0.82, 0.92, 1.02];
export const CARD_OFFSETS = [-0.06, 0, 0.06];
export const REFINE_SCALE_STEP = 0.045;
export const REFINE_OFFSET_STEP = 0.03;
export const REFINE_ANGLES = [-6, -3, 3, 6];

/**
 * Hamming distances out of 128 bits. Measured with simulated hand-held frames: the true card scores 0–8
 * when ideal and ~4–22 hand-held (glare, dim light, off-center, small, tilted); the closest wrong card or
 * token scored 26 at best, and an empty table is rejected by MIN_TEXTURE before matching.
 */
export const ART_ACCEPT_DISTANCE = 16;
/** ...with the runner-up card at least this much further away, one frame is enough to open. */
export const ART_MARGIN = 12;
/** Matches this close (and VOTE_MARGIN ahead of the runner-up) are votes; VOTES_TO_OPEN in VOTE_WINDOW frames open. */
export const ART_VOTE_DISTANCE = 22;
export const VOTE_MARGIN = 6;
export const VOTES_TO_OPEN = 2;
export const VOTE_WINDOW = 5;
/** Matches this close are only ever offered as "Is this…?", never opened. */
export const ART_GUESS_DISTANCE = 27;
/** Card-like frames without a decision before the closest guesses are offered. */
export const MAX_SCENE_FRAMES = 28;
/** Mean frame change that counts as a new scene after a guess was offered. */
export const SCENE_CHANGE_DIFF = 18;

export const EMPTY_COMBOS: ComboState = {
  oracleId: null,
  items: [],
  nextOffset: null,
  status: "idle",
  error: null,
  expanded: false,
};

export const RARITY_LABELS: Record<string, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  mythic: "Mythic",
  special: "Special",
  bonus: "Bonus",
};

export const FINISH_LABELS: Record<string, string> = { nonfoil: "Nonfoil", foil: "Foil", etched: "Etched", glossy: "Glossy" };

export const COLOR_NAMES: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" };
