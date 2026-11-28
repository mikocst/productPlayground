# Card Scanner

## What It Does
Hold a Magic: The Gathering card up to the camera and it is recognized automatically, with no capture button
and no text reading.

A Web Worker finds the card's outline in each frame and straightens it with a perspective transform. It then
fingerprints the whole card (frame, art, title bar, text box) and matches the fingerprint against an index of
every paper printing on Scryfall. Because the frame and border are part of the fingerprint, it often
identifies the exact printing, not only the card.

The card then opens at the matched printing. The result view shows, top to bottom:
- the card name;
- a price button per store (TCGplayer, Card Kingdom, Cardmarket, Cardhoarder), each showing that store's prices for the selected printing and linking to its product page;
- the tiltable 3D card next to every printing (set, rarity, finish);
- the top three Commander Spellbook combos with an expandable full list.

Photo upload and typed search are fallbacks.

Matching is tuned so a wrong card is never opened silently:
- One frame opens a card only when the match is very close and far ahead of every other card.
- Otherwise three confident frames must agree.
- Weaker matches are only offered as "Is this X?".

`?debug=1` adds a readout over the camera:
- time per frame and frames per second;
- the best and runner-up matches with their distances;
- the printing guess;
- the detected outline, drawn over the video.

`?scanner=v1` runs the previous art-window engine for side-by-side comparison.

## Architecture
```text
 build time   scripts/build-card-index.ts   (re-run for new sets; hashes are cached, so a rebuild takes ~2 min)
   Scryfall bulk "default_cards" ─▶ paper, non-token ─▶ `small` image per face
     ─▶ headless Chromium decodes pixels ─▶ lib/cards/card-hash.ts (pure)
     ─▶ group by card (oracle id); printings whose hashes are within 2 bits share one "look"
     ─▶ public/data/card-index.<contenthash>.bin  (+ card-index.manifest.json naming it)

 run time
   main thread (CameraScanner)
     getUserMedia ─▶ every 40 ms, if the worker is idle (else the tick is a no-op):
       crop the guide box + 12% margin ─▶ ≤720 px tall ─▶ ImageData ─▶ postMessage (buffer transferred)
   worker (scan.worker.ts → pipeline.ts)
     tracked quad from the last confident frame? ─▶ hash it ─▶ still confident? done
     else detectOutlines (outline.ts: 320 px, blur, Sobel, angle-limited Hough, quad filters, edge support)
       ─▶ per outline, best first: homography ─▶ 64×64 luma ─▶ DCT ─▶ 256-bit hash ─▶ search
          (stop at the first confident one)
       ─▶ no outline: the guide box itself, if it has texture
       ─▶ not confident: nudge each edge, re-hashing against the 20 nearest entries only
     ─▶ { outline, quad, best card, runner-up (a different card), printing guess, ms }
   main thread
     autoScan.recordFrame: instant / streak / confirm / re-arm ─▶ onOpen | onConfirm | onMiss

   Typed name ─▶ POST /api/card-scanner/recognize (Scryfall fuzzy + autocomplete) ─▶ open
   Combos     ─▶ GET /api/card-scanner/combos?oracleId&offset&limit (Commander Spellbook)
   Prices     ─▶ TCGplayer / Cardmarket / Cardhoarder: from the printing (Scryfall's daily store prices)
                 Card Kingdom: GET /api/card-scanner/card-kingdom/:printingId
                   (Card Kingdom's public price list, ~70 MB, cached server-side for 6 h as a lookup by Scryfall id)
```

## Frontend / API
- **State** lives in `CardScanner`: recognition phase, card load state, printing index and slide direction, combo list state, and Card Kingdom prices keyed by printing.
- **Deep link:** `?card=<oracle id>&print=<scryfall id>` is written with `history.replaceState` and read after mount. Scanning opens the matched printing directly.
- **Camera:**
  - Starts on tap, or automatically when the Permissions API reports camera access already granted.
  - Asks for the rear camera at up to 1920×1440 and requests continuous autofocus where supported.
  - Stops all tracks on unmount, including a stream that arrives after unmount.
  - The page must be a secure context (HTTPS or localhost). Insecure pages show a message instead of failing silently.
- **Testing on a phone in development:**
  - `next.config.ts` allows private-network hosts in `allowedDevOrigins`. Without it the page never hydrates on the phone, so buttons do nothing.
  - `npm run dev:mobile` serves HTTPS on all interfaces. Accept the self-signed certificate warning on the phone.
  - A deployed preview (HTTPS) also works.
- **Worker** (`scanEngine.ts`, `scan.worker.ts`):
  - Created with `new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" })`, which Turbopack bundles.
  - The worker downloads and parses the index itself, so the page thread never touches it.
  - One frame is in flight at a time. While the worker is busy, a camera tick does nothing, so frames never queue up.
  - Each scan view opens a session. A result that arrives after the view has closed (the card already opened, or the user left) is discarded in `scanEngine`, because only the page knows what is on screen.
  - The worker stays alive 3 minutes after the scan view closes, so "Scan" again starts without reloading the index.
- **Index file:**
  - `card-index.<16-hex hash>.bin` is served with `Cache-Control: immutable` (see `next.config.ts`).
  - The small manifest is revalidated on every load, so a rebuild only changes the manifest and the browser fetches the new file.
  - The reader checks the magic, version, and every count and string index, and fails closed: the overlay says the index couldn't load, and typed search still works.
- **Outline detection** (`outline.ts`):
  - Lines are searched only within 25° of vertical or horizontal, and each edge pixel votes only within 12° of its own gradient direction. This makes detection faster, and it ignores the diagonal clutter that causes false quads.
  - The cost is that a card rotated more than about 25° in the image isn't outlined. The guide frame keeps people well inside that.
  - Quads must have card-like proportions (aspect 0.6–0.84, opposite sides within 30%), cover at least 12% of the crop, and have gradient support along at least 35% of every side.
  - The 30% side tolerance is looser than the 20% first planned; at 20%, a card tilted 30° toward the camera never outlined.
- **Hash** (`lib/cards/card-hash.ts`):
  - Samples 64×64 luma from the straightened card, inset 5% horizontally and 4% vertically. The inset drops rounded corners and sleeve edges.
  - Each output pixel averages 2×2 bilinear samples, from a plane box-shrunk so the card is about the height of the index images (204 px).
  - Keeps the low 16×16 DCT coefficients: 256 bits, one per coefficient above their median.
  - The same file hashes the index (in Chromium), camera frames (in the worker), and the eval, so they agree bit for bit.
- **Index** (`lib/cards/card-index.ts`):
  - Entries are stored contiguously by card name. One pass over the index therefore yields both the best match and the closest *different* card (the runner-up), without a map.
  - The same layout makes printing lookup cheap: the accepted card's entries are one contiguous run.
  - The search uses an inlined 16-bit-table popcount: about 1.5 ms for 97k entries on a desktop.
- **Decisions** (`autoScan.ts`, distances out of 256 bits; thresholds and their measurements are in `data.ts`):
  - **Confident frame:** distance ≤ 56 and ≥ 10 ahead of the runner-up.
  - **Instant open:** distance ≤ 36 and margin ≥ 24.
  - **Streak:** otherwise, 3 confident frames on the same card open it.
  - **Confirm:** after 45 outlined frames without an open, the closest card within 60 bits is offered as "Is this X?". With nothing that close it shows "Couldn't match". At 68 bits, tokens were sometimes offered.
  - **Glare hint:** an outline without a confident match for 2 s shows "Tilt the card to cut the glare".
  - **Re-arm:** a card that was just offered is ignored until it has been out of view 4 frames in a row. This survives the trip to the result view and back for a minute, so tapping "Scan" with the card still in hand doesn't reopen it.
  - The motion, texture and sharpness gates of v1 were dropped. Blurry or empty frames simply don't produce a confident outline-plus-hash, and the eval shows no wrong opens without the gates.
- **Exact printing:**
  - Among the accepted card's entries within 36 bits of its best, if all come from one set (and one collector number) the printing is certain. Otherwise the closest entry's newest printing opens, and the carousel lets you step to yours.
  - Printings that share art and frame and differ only in the set symbol are one merged entry. They can't be told apart from a 64×64 hash.
- **Photo upload:** the photo is reduced to 1280 px and goes through the same worker pipeline. Both the detected outlines and the whole image are tried as the quad, so cropped scans and photos of a card on a table both work. It makes a single-shot decision: open when confident, otherwise ask.
- **3D card:** CSS 3D with motion springs.
  - Drag tilts up to 22°. Printings change with the arrow buttons, the set strip, or arrow keys; there is no swipe gesture.
  - Mouse hover tilts up to 8°; gyroscope tilt is opt-in on touch devices.
  - Double-faced printings get Flip (and the F key).
  - Reduced motion removes hover and gyroscope tilt and turns slides into fades.
- **Store prices** (`StorePrices`):
  - One tile per store for the selected printing, linking to that store's product page.
  - TCGplayer shows Normal / Foil / Etched (USD), Cardmarket Normal / Foil (EUR), and Cardhoarder MTGO tix. These are Scryfall's daily prices from those stores; their own APIs require approved developer keys.
  - Card Kingdom shows Normal / Foil retail from its own price list, marked "sold out" when out of stock. It loads per printing and is keyed by printing id, so a slow response never appears under another printing.
  - The tiles are labeled as not live quotes.
- **Printing carousel:** prev/next, a set-code strip, and rarity/finish/date badges. The strip starts at the left and only scrolls when the selected set would be hidden, bringing it to the left edge (no centering, no page scroll).
- **Combos:** the top 3 by Spellbook deck popularity. "Show all combos" pages by 20 from the API's next offset.
- **Card preview modal** (`CardModal`): tapping a card in a combo opens it full size in a native `<dialog>` over a dimmed backdrop.
  - Tapping anywhere except the card closes it, as does Escape (a screen-reader-only Close button is also provided).
  - It fades with a 0.2 s easeOut and does not scale, which keeps the card crisp. It uses Scryfall's 744×1040 PNG via Spellbook.
- **Controls:** Scan (back to the camera) as the primary-blue call to action in the header. Under the card: Flip for double-faced printings, and Motion tilt on touch devices. Reset and Surprise me controls were removed at the owner's request.
- **API routes:** the browser never calls Scryfall or Commander Spellbook APIs directly.
  - `POST /recognize` resolves typed names: fuzzy lookup, then autocomplete on shrinking prefixes for typos.
  - `GET /card/[oracleId]` returns every printing.
  - `GET /combos` resolves the card name server-side.
  - `GET /card-kingdom/[printingId]` returns Card Kingdom Normal/Foil offers. The first request after a cold start downloads the list (~4 s); later ones are instant.
  - All routes return `{ error }` with 400/404/429/502/504/500 and in-memory TTL caches.
  - The index is a static file; card images load from Scryfall's image CDN.

## Measurements
`npx tsx scripts/eval-scanner.ts` runs both engines on the same frames, in headless Chromium on a desktop.

**What the synthetic frames are:**
- Built from Scryfall `normal` scans, not the `small` images the index uses: 36 random printings, 6 borderless, 6 old-frame, 6 tokens (not in the index) and 2 empty tables.
- Each is warped into 520×720 camera crops under 10 conditions, then JPEG-compressed.
- The conditions: flat, hand-held, angled 20°, angled 30°, small, glare, dim, sleeve on a busy table, blurry, and foil tint.
- **Live** replays up to 60 jittered frames through the decision rules. **Photo** is one frame through the upload path.

**Live** (480 card scenes, 80 negative scenes):

| | v1 (art window) | v2 (outline + whole card) |
|---|---|---|
| Opened the right card | 335 (70%) | 478 (99.6%) |
| Opened a wrong card | 1 | 0 |
| Asked "Is this X?" instead | 57 | 0 |
| No match | 87 | 2 |
| Exact printing, of right opens | 157 (47%) | 378 (79%) |
| Negatives opened | 0 / 80 | 0 / 80 |
| Weakest condition | small: 0 / 48; angled 30°: 16 / 48 | sleeve on a busy table: 46 / 48 |
| Time per frame (desktop) | ~48 ms, on the page thread | card 9.5 ms median (p90 24); empty 6 ms; outline without a match 21 ms. All in the worker. |

- With v2, 390 of 478 cards open on their first frame, and the slowest took 11 frames.
- The page thread showed no long tasks while scanning (Chromium's long-task observer, in an end-to-end run with a fake camera).

**Photo upload:**
- v1 opened 30 of 480. It assumes the card fills the photo, so a card on a table fails.
- v2 opened 460 (96%), with no wrong opens and 362 exact printings.

**Other checkpoints:**
- **Hash alone** (clean scan, image-corner quad, no detection): 48/48 correct; median distance 6, smallest margin to another card 28.
- **Detection alone:** an outline lands within 3% of the true corners in 85–100% of frames per condition, with a median corner error of 0.2–0.4%. Sleeve frames are the exception at 2.2%, because the outline follows the sleeve. Detection takes about 6.7 ms.
- **Threshold sweep, 3,840 card frames and 528 negative frames:**
  - The right card's distance has a median of 26, p90 48, p99 56.
  - The closest wrong or negative frame is 62.
  - At ≤ 56 with margin ≥ 10, 98% of card frames are confident and none are wrong. Loosening to 64 lets 3 wrong frames through.
- **Index:** 34,248 cards, 97,379 looks and 101,819 printings in 6.65 MB, against the plan's 5 MB target.
  - The hashes take 3.1 MB and the Scryfall printing ids 1.6 MB; both are random bytes, so compression doesn't help.
  - Merging looks within 16 bits would save 0.7 MB, but it cut exact printings from 78% to 72%, so the merge stays at 2 bits.
  - The index parses in about 11 ms.
- **Real photos:** not measured yet. Put phone photos in `scripts/fixtures/scanner/` (see its README) and re-run the eval. Synthetic frames come from clean scans, so real cards (print variation, sleeves, gloss) will score higher distances.

## AI Usage
No AI models. Recognition is classical computer vision:
- outline detection with a Hough transform;
- perspective correction with a homography;
- a DCT perceptual hash, matched by brute-force nearest-neighbour search on Hamming distance.

## Key Dependencies
- **App:** Next.js 16 route handlers and Turbopack worker bundling, React 19, and motion.
- **Data:** the Scryfall bulk data, image CDN, and API; the Commander Spellbook API; and Card Kingdom's public price list for CK prices.
- **Build and eval:** esbuild and Playwright run the index builder and the eval.
- **Shared code:** `Button`, `Badge`, `cn`, `useHydrated`, and semantic theme tokens.

## Component Tree
```text
page.tsx
└─ CardScanner                  state, fetch orchestration, URL sync
   ├─ CameraScanner             camera, frame loop, decisions, upload        (scan view)
   │  └─ ScanDebug              ?debug=1 readout and outline overlay
   ├─ RecognitionStatus         matching · resolving · confirm · no-match · error
   ├─ ManualSearch              typed name fallback
   ├─ StorePrices               per-store price tiles                         (result view)
   ├─ CardViewport              3D card, tilt, flip, gyro
   ├─ PrintingCarousel          printing nav, set index
   └─ ComboList → ComboItem     top 3 + expanded list
      └─ CardModal              full-size card preview
 (worker) scan.worker.ts → pipeline.ts → outline.ts, card-hash, card-index   [engineV1.ts for ?scanner=v1]
```

## Error Handling
- **Camera:** blocked, unsupported/insecure, missing, and failed-start states each show a message with a retry. Upload and typed search remain available.
- **Index:**
  - If the manifest or index fails to load or validate, the overlay says so and typed search remains.
  - Upload is disabled until the index is ready.
  - A crashed worker rejects pending frames, and the next session starts a new one.
- **Matching:**
  - Frames without a confident match never open anything. Matches that are close but uncertain become a question.
  - After an open or a question, the same card is ignored until it leaves the view.
  - Canvas failures skip the frame.
- **Network:** typed lookups use an `AbortController`. Card-load failures offer Retry / Back to scanner. Combo failures offer Retry without hiding the card.
- **Server:**
  - Timeouts: 8 s, or 15 s for Commander Spellbook.
  - Responses are capped at 6 MB and parsed with defensive JSON readers.
  - Upstream 404/400 map to 404, 429 to 429, timeouts to 504, and other failures to 502.
- **Known limits:**
  - Printings that differ only in the set symbol resolve to the newest; step through the printings to yours.
  - Cards rotated more than ~25° in the image, or photographed at a very steep angle, aren't outlined. They fall back to the guide box, or fail by not matching, never by matching wrong.
  - New sets need the index rebuilt.
  - Desktop webcams often can't focus close up; hold the card at arm's length rather than filling the frame.

## File Structure
- `page.tsx`: thin route entry
- `CardScanner.tsx`: top-level state, data loading, URL sync, controls
- `CameraScanner.tsx`: camera lifecycle, guide overlay, frame loop, decisions, upload
- `ScanDebug.tsx`: `?debug=1` readout and outline overlay
- `scanEngine.ts`: worker lifecycle, typed messages, in-flight flag, sessions
- `scan.worker.ts`: worker entry; loads the index, runs the pipeline, keeps the tracked quad
- `pipeline.ts`: per-frame pipeline (tracking, outlines, hashing, refinement, printing guess)
- `outline.ts`: outline detection
- `autoScan.ts`: decision rules (instant, streak, confirm, re-arm, glare hint)
- `geometry.ts`: guide frame, cover mapping, worker crop
- `RecognitionStatus.tsx`, `ManualSearch.tsx`: recognition feedback and typed fallback
- `StorePrices.tsx`: per-store price tiles for the selected printing
- `CardViewport.tsx` (3D card with tilt and flip), `PrintingCarousel.tsx`, `ComboList.tsx`: result views
- `CardModal.tsx`: full-size card preview for combo cards
- `scryfall.ts`, `combos.ts`: client fetchers for the internal API routes, formatting
- `types.ts`, `data.ts`: prototype types and tunable constants (with the measurements behind them)
- **Scanner v1, kept only for the `?scanner=v1` comparison and to be deleted after a real-phone check:**
  - `engineV1.ts`, `autoScanV1.ts`, `artIndex.ts`, `scanner.ts`
  - `lib/cards/art-hash.ts`, `scripts/build-card-art-index.ts`, `public/data/mtg-art-index.json`
- `lib/cards/card-hash.ts`, `lib/cards/card-index.ts`: shared whole-card hash and binary index
- `scripts/build-card-index.ts`: builds the index; `scripts/eval-scanner.ts` (+ `scripts/eval/page.ts`): offline eval; `scripts/fixtures/scanner/`: real-photo fixtures
- `app/api/card-scanner/*/route.ts`, `lib/cards/*`: server routes and service wrappers
