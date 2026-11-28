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

export const TILT_SPRING = { stiffness: 300, damping: 30 };

// ---------- Scanner v2: outline detection + whole-card hash, in a worker ----------

/** Names the current whole-card index file (scripts/build-card-index.ts); the .bin itself is cacheable forever. */
export const CARD_INDEX_MANIFEST_URL = "/data/card-index.manifest.json";

/** Frames are offered this often; while the worker is busy the tick is a no-op (no backlog). */
export const FRAME_INTERVAL_MS = 40;
/** Area around the guide (fraction of its size, per side) sent to the worker, so a loose card is still whole. */
export const CROP_MARGIN = 0.12;
/** The crop is downscaled to at most this many pixels tall before it is sent. */
export const MAX_FRAME_HEIGHT = 720;
/** The worker (and its parsed index) outlives the scan view this long, so "Scan" again starts instantly. */
export const WORKER_KEEP_ALIVE_MS = 180_000;

/** Outline detection (outline.ts) runs on a copy with this longest side. */
export const DETECT_SIZE = 320;
/** Hough votes come from pixels above this gradient-magnitude percentile (with a floor); edge support uses a looser one. */
export const VOTE_PERCENTILE = 0.85;
export const VOTE_FLOOR = 40;
export const SUPPORT_PERCENTILE = 0.8;
export const SUPPORT_FLOOR = 28;
/** Lines are only searched within this many degrees of vertical/horizontal… */
export const LINE_BAND = 25;
/** …and within this many degrees of each pixel's own gradient direction. */
export const GRADIENT_WINDOW = 12;
/** Hough peaks kept, strongest lines used directly, and extreme (outermost) lines added per side. */
export const MAX_LINES = 40;
export const STRONG_LINES = 10;
export const EXTREME_LINES = 2;
/**
 * Quad filters: corners may sit this far outside the frame; card aspect (0.716) range; minimum frame coverage;
 * max opposite-side difference (0.2 rejected every card tilted 30° toward the camera; 0.3 outlines 43/48 of them);
 * min gradient support on every side.
 */
export const CORNER_SLACK = 0.08;
export const MIN_ASPECT = 0.6;
export const MAX_ASPECT = 0.84;
export const MIN_AREA = 0.12;
export const MAX_SIDE_DIFF = 0.3;
export const MIN_SIDE_SUPPORT = 0.35;
/** Outlines hashed per frame: best by score plus best by shape alone. */
export const OUTLINES_BY_SCORE = 3;
export const OUTLINES_BY_SHAPE = 2;
/** When no outline is confident, each edge is moved by these fractions of the card height (two passes), re-hashing against the nearest entries only. Positive is outward. */
export const REFINE_EDGE_STEPS = [-0.03, 0.02, 0.05];
export const REFINE_PASSES = 2;
export const REFINE_NEAREST = 20;
/** Without any outline, the guide box itself is tried if it has at least this much contrast (luma std dev). */
export const GUIDE_FALLBACK_TEXTURE = 14;

/**
 * Hamming distances out of 256 bits. A frame is *confident* when its best card is this close and this far ahead
 * of any other card. Measured (scripts/eval-scanner.ts, 3,840 synthetic card frames across 10 conditions plus 528
 * token/empty frames): the right card scores median 26, p90 48, p99 56; the closest wrong or negative frame
 * scored 62. At 56/10, 98% of card frames are confident and none are wrong; at 64, 3 wrong frames get through.
 */
export const CONFIDENT_DISTANCE = 56;
export const CONFIDENT_MARGIN = 10;
/** One frame opens a card when it is this close and this far ahead (26 bits below the closest wrong frame). */
export const INSTANT_DISTANCE = 36;
export const INSTANT_MARGIN = 24;
/** Otherwise this many consecutive confident frames on the same card open it. */
export const STREAK_TO_OPEN = 3;
/** A card that was just offered isn't offered again until it has been out of view this many frames in a row. */
export const REARM_MISSES = 4;
/** An outline without a confident match for this long suggests glare. */
export const GLARE_HINT_MS = 2000;
/** After this many outlined frames without a decision, the closest card within GUESS_DISTANCE is offered as "Is this…?". */
export const MAX_OUTLINED_FRAMES = 45;
/** The right card scores ≤ 56 in 99% of frames; at 68, tokens (not in the index) were offered as a guess in 8 of 80 runs. */
export const GUESS_DISTANCE = 60;
/** Entries of the accepted card within this many bits of its best are plausible printings. */
export const PRINTING_SPREAD = 36;

// ---------- Scanner v1 (art-window search, ?scanner=v1) ----------

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
