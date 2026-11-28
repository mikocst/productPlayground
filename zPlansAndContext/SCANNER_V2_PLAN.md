# Card Scanner v2: Outline Detection + Whole-Card Hashing

Replace the recognition engine behind `CameraScanner` with a detect → straighten → hash → match pipeline that runs in a Web Worker. This is the technique Moxfield's deck-editor scanner uses. Re-implement it from the description below; don't copy their code or their index file.

The rest of the prototype stays the same: `CardScanner`, the result views, the API routes, and the `onOpen / onConfirm / onMiss` contract.

Follow `CLAUDE.md` throughout: work on a branch, keep pure logic in its own files, put thresholds in `data.ts`, keep `HOW_IT_WORKS.md` current, and run lint, typecheck and build before you finish.

---

## 1. Why the current scanner is slow

Your pipeline already uses the right family of techniques: a prebuilt pHash index, brute-force Hamming search, and a runner-up check against a *different oracle id* in `lead()`. The gap is in **how much work each frame does** and **what gets hashed**.

| | Current (`CameraScanner` + `scanner.ts`) | v2 target |
|---|---|---|
| Where the card is | *Searched*: 27 coarse + 30 refine placements per frame | *Detected*: 1–3 outline quads; on a tracked frame, the previous quad is reused |
| Hashes per frame | ~57, each with a `drawImage` + `getImageData` GPU readback at 128² | 1–3, from one readback of the frame |
| Index comparisons per frame | ~50k entries × 57 queries ≈ 2.9M | ~110k entries × 1–3 |
| Thread | Main thread, `setTimeout` every 160 ms | Worker; frames sent every ~40 ms, one at a time (no backlog) |
| Region hashed | Art window only (80% × 38% of the card), from 146 px-wide Scryfall `small` images | The whole card, inset 4–5%, perspective-corrected |
| Fingerprint | 128 bits: 8×8 luma + 8×8 red−blue | 256 bits: 16×16 luma DCT from 64×64 |
| Tilt handling | Canvas rotation by ±3°/±6° | A homography from the detected corners handles rotation *and* perspective |
| Gates before matching | Motion EMA, texture, sharpness relative to the recent best | Outline found (texture and blur fail naturally) + streak voting |
| Index | ~6 MB JSON with a base64 payload, `unique_artwork` (~50k) | Binary, every paper printing grouped by name, about 3–5 MB |

Your own `HOW_IT_WORKS.md` measures this at **~50 ms per frame on desktop and 2–4 matches/s on a phone.** The goal for v2 is **under 10 ms per frame on desktop and at least 15 analyzed frames/s on a mid-range phone**, with the UI thread doing almost no work.

**Why the whole card helps with exact printings.** An art-only hash can't tell a borderless printing from a regular-frame printing that shares the art, and you already collapse those to "one representative printing." Hashing the whole card brings in the frame, title bar, text box and border color. That separates many of those printings for free.

---

## 2. Target architecture

```text
 build time   scripts/build-card-index.ts
   Scryfall bulk "default_cards" ─▶ paper, non-token ─▶ `small` image per face
     ─▶ headless Chromium decodes pixels ─▶ lib/cards/card-hash.ts (pure, no canvas)
     ─▶ group by oracle id, dedupe identical hashes
     ─▶ public/data/card-index.<contenthash>.bin + card-index.manifest.json

 run time
   main thread (CameraScanner.tsx)
     getUserMedia ─▶ every 40 ms, if worker idle:
       crop guide box + margin ─▶ ≤720 px tall ─▶ ImageData ─▶ postMessage(transfer)
   worker (scan.worker.ts)
     tracked quad? ─▶ hash it ─▶ confident? ─▶ done
     else detectOutlines (320 px, blur, Sobel, angle-limited Hough, quad filters)
       ─▶ hash each quad (homography → 64×64 → DCT → 256 bits)
       ─▶ search: best + runner-up with a different name
       ─▶ not confident? nudge edges, re-hash against top-20 only
     ─▶ { hasOutline, quad, nameIndex, distance, runnerUp, printing?, ms }
   main thread
     streak / instant-accept vote ─▶ onOpen(match) | onConfirm | onMiss   (unchanged contract)
```

### New and changed files

```text
lib/cards/card-hash.ts           pure: homography, warp, DCT, 256-bit hash, popcount   (shared with the builder)
lib/cards/card-index.ts          pure: binary index read/write, search with name-level runner-up
app/prototypes/card-scanner/
  outline.ts                     pure: downscale, blur, Sobel, Hough, quad assembly + scoring
  scan.worker.ts                 worker entry: load index, per-frame pipeline, tracking
  scanEngine.ts                  main-thread wrapper: worker lifecycle, in-flight flag, typed messages
  autoScan.ts                    rewritten: streak / instant rules on name index
  CameraScanner.tsx              camera + overlay only; drives scanEngine
  data.ts                        new thresholds (out of 256), detection constants
scripts/build-card-index.ts      replaces build-card-art-index.ts
scripts/eval-scanner.ts          offline accuracy/timing on real photos
```

`scanner.ts`, `artIndex.ts`, `lib/cards/art-hash.ts` and `mtg-art-index.json` get deleted in Phase 7 after the comparison.

---

## 3. Phases

Each phase ends with a **checkpoint**: something you can measure before moving on. The **Think about** questions are decisions worth reasoning through yourself. Bring your answers back and we can compare notes.

### Phase 0: Measure before changing anything

1. Add a debug readout over the camera, behind `?debug=1`: ms per frame, frames analyzed per second, best and runner-up distance, and the name of the leading card.
2. Build a **real-photo test set** on your phone: about 30 of your own cards, with 3 shots each (flat on a table, held in hand, angled about 20°). Include a few foils, a borderless card, two reprints sharing art, and 3 tokens as negatives. Save them in `scripts/fixtures/scanner/` with the expected oracle and printing id in the filename or a JSON sidecar.
3. Write `scripts/eval-scanner.ts`. Run every fixture through the current upload path and report: correct name, correct printing, wrong card, no match, and ms.

**Checkpoint:** a baseline table you can paste into `HOW_IT_WORKS.md`. Your current measurements come from Scryfall scans with simulated effects, and real photos will be worse. You need the real number to know whether each later phase helped.

**Think about:** what's the one metric that matters most to *you*? Time to open, wrong-card rate, or exact-printing rate? It decides how you tune Phase 6.

### Phase 1: Move the *current* pipeline into a Worker

Do this before changing any algorithm, so worker plumbing and algorithm changes don't get debugged at the same time.

1. Create `scan.worker.ts` and `scanEngine.ts`. Check how Next 16 + Turbopack bundles workers in `node_modules/next/dist/docs/`, as `AGENTS.md` says. The standard form is `new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" })`.
2. The worker loads the index itself. The main thread posts `{ type: "frame", id, width, height, pixels }`, with `pixels.buffer` in the transfer list.
3. **Backpressure:** `scanEngine` keeps an `inFlight` flag and drops new frames while it's set. Switch the tick from 160 ms to `setInterval(…, 40)`. Each tick is a cheap no-op while the worker is busy.
4. `hashRegion` uses a DOM canvas, which doesn't exist in a worker. For this phase, either use `OffscreenCanvas` or do one `getImageData` on the main thread and port the sampling to pixel arrays. The second option is a step toward Phase 2.
5. Keep the worker alive for a few minutes after the scanner unmounts, so a re-scan doesn't reload the index.

**Checkpoint:** same accuracy as Phase 0, while scrolling and the 3D card stay smooth during scanning. Frames per second should rise somewhat, simply because the UI no longer blocks.

**Think about:** what should happen to a frame result that comes back after the user has already left the scan view? Where does that check belong, in the worker or in `scanEngine`?

### Phase 2: A pure 256-bit whole-card hash

`lib/cards/card-hash.ts`, with no imports and no DOM, so the builder, the worker and tests all share it:

- `homography(quad) → 3×3`: maps the unit square to the four detected corners (TL, TR, BR, BL).
- `warpGray(pixels, w, h, H, inset) → Float32Array(64×64)`: for each output pixel, average **2×2 bilinear samples** (cheap anti-aliasing) from the quad. The sample area is inset to x 5–95% and y 4–96%, which drops the rounded corners, sleeve edges and background.
- `dct2(block, n=64, keep=16)`: separable DCT with a cached cosine table. Keep the top-left 16×16.
- `hash256(coeffs) → Uint32Array(8)`: set a bit wherever the coefficient is above the median of the 255 non-DC values.
- `hamming256(a, aOff, b)`: 8 XOR + popcount operations.

For the builder and uploaded photos, the quad is just the image corners. A card scan *is* the card.

**Checkpoint:** a unit test where a Scryfall `small` image hashed in Node and in Chromium gives identical bits. Then add a synthetic test: warp the same image by a known perspective, give the function the true corners, and check that the distance comes back under about 20 bits.

**Think about:** why drop the chroma half you have now? Red−blue chroma helped an art-only hash. Does it still earn its bits once the frame and text box are included? Try it in Phase 6 and let the eval decide.

### Phase 3: The v3 index

Rewrite the builder as `scripts/build-card-index.ts`, keeping your Playwright decode approach so pixels come from the same decoder the phone uses.

1. Source is **`default_cards`**, not `unique_artwork`, because whole-card hashes differ per printing. Keep your existing paper, layout and set-type filters.
2. The `small` image (146×204) is enough: the hash samples at 64×64. Build time is roughly 2× today's, so keep `--limit` for quick iterations.
3. Group by oracle id. Within a name, **merge printings whose hashes are within a couple of bits**. Each index entry is then "one distinct look" with a list of printings.
4. Binary layout (little-endian), starting with a header: magic `"CSIX"`, version, entry count, name count, printing count, build date and newest set code. After the header come these tables:
   - names (UTF-8, `\n`-joined)
   - set codes and collector numbers (string tables)
   - an entry count for each name (`Uint16[names]`), so entries are contiguous by name
   - hashes (`Uint32[entries × 8]`)
   - a printing count for each entry (`Uint16[entries]`)
   - printings (`Uint16 setIdx, Uint16 collectorIdx` pairs), plus a parallel table of Scryfall ids so `onOpen` still gets a `printingId`
5. Write `card-index.<16-hex contenthash>.bin` plus a small `card-index.manifest.json` that names it. The browser can cache the `.bin` forever, and a rebuild just changes the manifest.
6. Validate every length while reading, and fail closed: the scanner shows "unavailable" and typed search still works.

**Checkpoint:** the file size (aim for under 5 MB), how long it takes to parse in the worker (aim for under 100 ms), and an eval run that **skips detection** and hashes uploads with image-corner quads. That run isolates "is the new hash and index better" from "is detection good."

**Think about:** contiguous-by-name storage lets the search track the runner-up *of a different name* in one pass, with no Map. Can you see why it makes the printing lookup in Phase 6 cheap too?

### Phase 4: Outline detection

`outline.ts`, pure, working on the RGBA buffer the worker receives:

1. **Downscale** to a longest side of 320 px with box averaging, keeping the scale factor.
2. **Blur** with a separable `[1, 2, 1]` kernel.
3. **Sobel** on each RGB channel, keeping the channel with the strongest gradient (borders often differ from the table in color more than brightness). Store magnitude and angle.
4. **Adaptive thresholds:** vote with pixels above roughly the 85th magnitude percentile (with a floor), and measure edge support with roughly the 80th.
5. **Angle-limited Hough:** accumulate only near-vertical (about 65–115° and 245–295°) and near-horizontal (about ±25°, 155–205°) bins, and only within ±12° of each pixel's own gradient angle. Non-max suppression, keep the top ~40.
6. **Quad assembly:** take the 10 strongest lines, plus the 4 leftmost/rightmost (or top/bottom) of the reasonably strong ones. Pair two vertical lines with two horizontal ones and intersect them. Reject a quad if:
   - its corners fall more than 8% outside the frame
   - its aspect ratio is outside 0.6–0.84 (a card is 0.716)
   - it covers less than 12% of the frame
   - opposite sides differ by more than 20%
7. **Edge support:** walk each side and count the fraction of points with a strong gradient within 1 px. Reject any quad where some side has under 35% support. Score = mean support × √(min side support) × (1 − 2·|aspect − 0.716|) × area².
8. Return the top 3 by score plus the top 2 by shape quality, with near-duplicates removed, scaled back to frame pixels.

**Tracking fast path:** if the last frame matched confidently at the same frame size, hash the previous quad first. If it's still confident, skip detection entirely.

**Refinement:** if no candidate passes, move each edge outward or inward by −3% to +5% of the card height, in two passes, re-hashing only against the 20 nearest entries from the first search. This rescues quads where one edge locked onto a sleeve or shadow.

**Fallback:** if no outline is found but the guide box is well filled, try the guide-box quad once. That keeps today's "card fills the frame" behavior working.

**Checkpoint:** a debug overlay that draws the detected quad on the video, and a fixture eval of detection alone: the fraction of photos whose quad corners land within 3% of hand-marked corners. Tune here before touching thresholds.

**Think about:** why does limiting the Hough to two angle bands make it faster *and* more accurate? What does the scanner give up by doing that, and does that limit matter for how people actually hold cards?

### Phase 5: Search and decisions

`lib/cards/card-index.ts` gets `search(index, hash, nearest = 0)`, which returns:
- `best { entry, nameIndex, distance }`
- `runnerUp`: the closest entry with a **different `nameIndex`**
- optionally the `nearest` K entries, for refinement

Rewrite `autoScan.ts` around name indexes (all distances out of 256; tune these in Phase 6):

| Rule | Starting value |
|---|---|
| Frame is *confident* | distance ≤ 56 and runner-up − distance ≥ 10 |
| **Instant accept** | distance ≤ 36 and margin ≥ 24 |
| **Streak accept** | 3 consecutive confident frames on the same name |
| Re-arm (don't re-add the same card) | that name has missed 4 frames in a row |
| Glare hint | outline found but not confident for over 2 s → "Tilt the card to cut the glare" |
| Confirm ("Is this X?") | keep your current flow: the best name after N outlined frames, if within a looser guess distance |

Drop the motion, texture and sharpness gates at first and measure. Blurry or flat frames fail to produce a confident outline-plus-hash, and the streak absorbs single bad frames. Add a gate back only if the eval shows wrong opens.

**Printing resolution (exact printings, step two):** after the name is accepted, look at that name's entries within the best distance + ~36. If they all map to one set, return that set, plus the collector number if it's unique too. Otherwise return the closest entry's printing, flagged `printingCertain: false`, and let `PrintingCarousel` open on it. Printings that share art and frame and differ only in the set symbol can't be told apart by a 64×64 hash. That's a separate problem (see Phase 8).

**Checkpoint:** the full eval in live mode (frame-by-frame replay of the fixtures with small jitter) and through upload. Compare against the Phase 0 baseline.

**Think about:** your current `lead()` already compares against the best *different oracle id*. That was the right instinct. What actually changes when the index is grouped by name, and why does the margin get more trustworthy?

### Phase 6: Tune with the eval, not by feel

1. Sweep the confident distance (40–64), the margin (6–16), and the streak length (2–4), with chroma bits on or off.
2. Pick the setting with **zero wrong opens** on your fixtures and the fastest median time to open. Write the measured numbers next to each constant in `data.ts`, as you do today.
3. Run once on your phone with `?debug=1` and check that real frames per second match the desktop extrapolation.

**Checkpoint:** a before/after table in `HOW_IT_WORKS.md`.

### Phase 7: Swap and clean up

1. Gate the engine during comparison with `?scanner=v1` / `v2` (defaulting to v2), and run both side by side on the same cards.
2. Keep the `CameraScanner` props identical so `CardScanner.tsx` doesn't change. Map the v2 result to the existing `ArtCandidate` shape (`printingId`, `oracleId`, `name`, `distance`).
3. Route photo upload through the same worker path, with image corners as the quad, so the camera and uploads can't drift apart.
4. After v2 wins, delete `scanner.ts`, `artIndex.ts`, `lib/cards/art-hash.ts`, `build-card-art-index.ts`, `mtg-art-index.json` and the `v1` flag.
5. Update `HOW_IT_WORKS.md` (architecture, thresholds, known limits, file structure). Then run lint, typecheck and build. Thumbnails only need recapturing if the scan view looks different.

### Phase 8 (optional): Exact printing beyond the hash

Only if Phase 6 shows the printing rate matters to you. After the name is accepted, crop the **collector line / set symbol** area (bottom-left) from the straightened card at full camera resolution. Then either:
- compare a small hash of just that region against the candidate printings only (a handful, not 110k), or
- run OCR on the collector number and set code. It's slow, but it only runs once per accepted card, never per frame.

---

## 4. Risks and open questions

- **Worker bundling in Next 16 / Turbopack:** check the docs before Phase 1. If workers misbehave in dev, a plain worker file in `public/` loaded by URL is an ugly but reliable fallback.
- **Build time and politeness:** about 110k image downloads from Scryfall's CDN. Keep your concurrency cap and user agent, and cache downloaded images on disk between builds.
- **Index freshness:** the manifest's `newestSet` and build date can show up in the debug readout, so you can tell when a rebuild is due.
- **Sleeves and glossy foils** add glare and fake edges. That's why the test set needs real photos, and why the glare hint exists.
- **Desktop webcams** often can't focus close up. Hint that the card should be at arm's length rather than filling the frame.

## 5. Order of work, at a glance

```text
0 measure ─▶ 1 worker (same algorithm) ─▶ 2 hash ─▶ 3 index ─▶ (eval: hash alone)
          ─▶ 4 detection ─▶ (eval: detection alone) ─▶ 5 decisions ─▶ 6 tune ─▶ 7 swap ─▶ 8 optional
```

Every arrow is a point where the eval tells you whether the change helped.
