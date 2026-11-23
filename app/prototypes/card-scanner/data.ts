import type { ComboState, Region } from "./types";

export const API_BASE = "/api/card-scanner";

/** Combos shown before "Show all". */
export const COMBO_PREVIEW = 3;
/** Page size when the full combo list is expanded. */
export const COMBO_PAGE = 20;

/** Physical MTG card ratio (63 × 88 mm). */
export const CARD_RATIO = 63 / 88;

/** Name line inside the card frame, as a fraction of card width/height. Excludes the mana cost corner. */
export const NAME_BAND: Region = { x: 0.06, y: 0.045, width: 0.74, height: 0.063 };

/** Guide frame height as a fraction of the camera viewport height. */
export const FRAME_HEIGHT = 0.86;

/** Tilt limits in degrees. */
export const DRAG_TILT = 22;
export const HOVER_TILT = 8;
export const GYRO_TILT = 14;
/** Horizontal drag distance (px) that switches printings on release. */
export const SWIPE_DISTANCE = 80;

export const TILT_SPRING = { stiffness: 300, damping: 30 };

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
