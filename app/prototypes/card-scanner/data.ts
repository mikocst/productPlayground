import type { ComboState, Region } from "./types";

export const API_BASE = "/api/card-scanner";

/** Combos shown before "Show all". */
export const COMBO_PREVIEW = 3;
/** Page size when the full combo list is expanded. */
export const COMBO_PAGE = 20;

/** Physical MTG card ratio (63 × 88 mm). */
export const CARD_RATIO = 63 / 88;

/**
 * Generous name-line search area inside the card frame (fraction of card width/height), excluding the
 * mana-cost corner. The text line itself is located inside it, so the card need not be perfectly aligned.
 */
export const NAME_BAND: Region = { x: 0.055, y: 0.03, width: 0.75, height: 0.1 };

/** Guide frame height as a fraction of the camera viewport height. */
export const FRAME_HEIGHT = 0.86;

/** Tilt limits in degrees. */
export const DRAG_TILT = 22;
export const HOVER_TILT = 8;
export const GYRO_TILT = 14;
/** Horizontal drag distance (px) that switches printings on release. */
export const SWIPE_DISTANCE = 80;

export const TILT_SPRING = { stiffness: 300, damping: 30 };

/** Auto-scan: how often the live frame is sampled. */
export const AUTO_TICK_MS = 200;
/** Mean grayscale change (0–255) between samples below which the frame counts as steady. */
export const STABLE_DIFF = 8;
/** Consecutive steady samples with text in the name band before OCR runs (~0.6 s). */
export const STABLE_TICKS = 3;
/** Fraction of strong horizontal edges in the name band that suggests printed text is there. */
export const MIN_BAND_EDGES = 0.05;
/** Mean change that counts as a new scene, re-arming attempts after misses. */
export const SCENE_CHANGE_DIFF = 18;
/** Quiet OCR attempts per scene; the last miss surfaces suggestions. */
export const MAX_SCENE_ATTEMPTS = 3;
/** Pause between attempts on the same scene. */
export const RETRY_DELAY_MS = 700;

export const OCR_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ',-";
/** Below this similarity, an OCR match is shown for confirmation instead of opened. */
export const OCR_CONFIDENT = 0.8;

/** Well-known Commander staples with documented combos, used by Surprise me. */
export const SURPRISE_CARDS = [
  "Sol Ring",
  "Dramatic Reversal",
  "Thassa's Oracle",
  "Kiki-Jiki, Mirror Breaker",
  "Walking Ballista",
  "Ashnod's Altar",
  "Exquisite Blood",
  "Basalt Monolith",
  "Heliod, Sun-Crowned",
  "Isochron Scepter",
  "Dockside Extortionist",
  "Delver of Secrets",
];

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
