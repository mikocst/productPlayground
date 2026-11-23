# Card Scanner

## What It Does
Hold a Magic: The Gathering card up to the camera and it is recognized automatically by its artwork. There is no capture button and no text reading. The camera frame is matched against a perceptual-hash index of every unique paper artwork on Scryfall.

The card then opens at the matched printing. The result view shows, top to bottom:
- the card name;
- a price button per store (TCGplayer, Card Kingdom, Cardmarket, Cardhoarder), each showing that store's prices for the selected printing and linking to its product page;
- the tiltable 3D card next to every printing (set, rarity, finish);
- the top three Commander Spellbook combos with an expandable full list.

Photo upload and typed search are fallbacks.

Matching is tuned so a wrong card is never opened silently:
- One frame opens a card only when the match is very close and far ahead of every other card.
- Otherwise several frames must agree.
- Weaker matches are only offered as "Is this X?".

## Architecture
```text
 build time (scripts/build-card-art-index.ts, re-run to pick up new sets)
   Scryfall bulk "unique_artwork" ─▶ paper cards, no tokens/art series ─▶ small image per face
     ─▶ headless Chromium + lib/cards/art-hash.ts ─▶ public/data/mtg-art-index.json
        (~50k artworks × 128-bit fingerprint + [printing id, oracle id, name, face], ~6 MB)

 run time (all matching in the browser)
   Camera (rear, getUserMedia) ── every 160 ms, unless paused ──┐
     sample guide frame 36×50 ─▶ motion (EMA diff)  > 22 → "Hold the card still"
     sample art window 96×64  ─▶ texture  < 10 → empty view, skip
                               ─▶ sharpness < 70% of recent best → blurry, skip
     coarse search: 27 card placements (3 sizes × 3×3 offsets)
        each: art window ─▶ 128×128 ─▶ 32×32 ─▶ DCT pHash (luma 64 bits + red−blue chroma 64 bits)
        ─▶ brute-force Hamming search over the index
     refine around the best placement: 26 finer placements + 4 tilts (±3°, ±6°)
     merge ─▶ autoScan.recordFrame (votes)
        open    ─▶ GET /api/card-scanner/card/:oracleId, select the matched printing
        confirm ─▶ "Is this X?" + other close cards
        surface ─▶ "Couldn't match" (after ~28 analyzed frames)
                   then wait for the scene to change before scanning again

   Typed name ─▶ POST /api/card-scanner/recognize (Scryfall fuzzy + autocomplete) ─▶ open
   Combos     ─▶ GET /api/card-scanner/combos?oracleId&offset&limit (Commander Spellbook)
   Prices     ─▶ TCGplayer / Cardmarket / Cardhoarder: from the printing (Scryfall's daily store prices)
                 Card Kingdom: GET /api/card-scanner/card-kingdom/:printingId
                   (Card Kingdom's public price list, ~70 MB, cached server-side for 6 h as a lookup by Scryfall id)
```

## Frontend / API
- **State** lives in `CardScanner`: recognition phase, card load state, printing index and slide direction, combo list state, and a reset signal for the 3D view.
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
- **Auto-scan matching:**
  - Card placement is searched rather than detected, so the card can be smaller than the guide, off-center, or slightly tilted.
  - Hand tremor is fine; only deliberate movement pauses matching.
  - Thresholds live in `data.ts` with the measurements behind them.
  - Decision rules (`autoScan.ts`, out of 128 bits):
    - Open on one frame when the distance is ≤ 16 and the best other card is ≥ 12 further away.
    - Otherwise open on 2 votes within 5 frames, where each vote is ≤ 22 and ≥ 6 ahead.
    - After 28 analyzed frames without a decision, ask "Is this X?" (≤ 27) or show "Couldn't match".
  - Measured on simulated hand-held 720p frames across 9 card frames × 6 conditions (ideal, hand-held, small, glare, tilted, dim):
    - 54/54 cards opened correctly, typically in 0.2–0.5 s, and 0 wrong cards.
    - 18/18 token scenes (tokens are not in the index) were rejected.
    - True matches scored 4–22; the closest wrong card or token never scored below 26. An empty table is gated by texture.
- **Photo upload:** hashes the centered card area with the same coarse-to-fine search and makes a single-shot decision (open, confirm, or "Couldn't match").
- **3D card:** CSS 3D with motion springs.
  - Drag tilts up to 22°; a horizontal drag over 80 px switches printing.
  - Mouse hover tilts up to 8°; gyroscope tilt is opt-in on touch devices.
  - Double-faced printings get Flip (and the F key); arrow keys change printing.
  - Reduced motion removes hover and gyroscope tilt and turns slides into fades.
- **Store prices** (`StorePrices`):
  - One tile per store for the selected printing, linking to that store's product page.
  - TCGplayer shows Normal / Foil / Etched (USD), Cardmarket Normal / Foil (EUR), and Cardhoarder MTGO tix. These are Scryfall's daily prices from those stores; their own APIs require approved developer keys.
  - Card Kingdom shows Normal / Foil retail from its own price list, marked "sold out" when out of stock.
  - Card Kingdom loads per printing and is keyed by printing id, so a slow response never appears under another printing.
  - The tiles are labeled as not live quotes.
- **Printing carousel:** prev/next, a set-code strip, and rarity/finish/date badges. The strip starts at the left and only scrolls when the selected set would be hidden, bringing it to the left edge (no centering, no page scroll).
- **Combos:** the top 3 by Spellbook deck popularity. "Show all combos" pages by 20 from the API's next offset.
- **Controls:** Scan (back to the camera) in the header and Reset view under the card. Reset and Surprise me controls were removed at the owner's request.
- **API routes:** the browser never calls Scryfall or Commander Spellbook APIs directly.
  - `POST /recognize` resolves typed names: fuzzy lookup, then autocomplete on shrinking prefixes for typos.
  - `GET /card/[oracleId]` returns every printing.
  - `GET /combos` resolves the card name server-side.
  - `GET /card-kingdom/[printingId]` returns Card Kingdom Normal/Foil offers. The first request after a cold start downloads the list (~4 s); later ones are instant.
  - All routes return `{ error }` with 400/404/429/502/504/500 and in-memory TTL caches.
  - The art index is a static file; card images load from Scryfall's image CDN.

## AI Usage
No AI models. Recognition is classical perceptual hashing (DCT pHash on luma and chroma) with nearest-neighbour search.

## Key Dependencies
Next.js 16 route handlers, React 19, and motion. Card Kingdom's public price list supplies CK prices. esbuild and Playwright are used by the index builder. The Scryfall bulk data, image CDN, and API, and the Commander Spellbook API supply the data. Shared `Button`, `Badge`, `cn`, `useHydrated`, and semantic theme tokens.

## Component Tree
```text
page.tsx
└─ CardScanner                  state, fetch orchestration, URL sync
   ├─ CameraScanner             camera, index load, auto-scan loop, upload   (scan view)
   ├─ RecognitionStatus         matching · resolving · confirm · no-match · error
   ├─ ManualSearch              typed name fallback
   ├─ CardViewport              3D card, tilt, swipe, flip, gyro, reset       (result view)
   ├─ PrintingCarousel          printing nav, set index, prices, links
   └─ ComboList → ComboItem     top 3 + expanded list
```

## Error Handling
- **Camera:** blocked, unsupported/insecure, missing, and failed-start states each show a message with a retry. Upload and typed search remain available.
- **Index:** if the art index fails to load, the overlay says so and typed search remains. Upload is disabled until the index is ready.
- **Matching:**
  - Empty or blurry frames are skipped.
  - Matches that are close but uncertain become a question, never an automatic open.
  - After a question or "Couldn't match", scanning waits for a different scene.
  - Canvas failures skip the frame.
- **Network:** typed lookups use an `AbortController`. Card-load failures offer Retry / Back to scanner. Combo failures offer Retry without hiding the card.
- **Server:**
  - Timeouts: 8 s, or 15 s for Commander Spellbook.
  - Responses are capped at 6 MB and parsed with defensive JSON readers.
  - Upstream 404/400 map to 404, 429 to 429, timeouts to 504, and other failures to 502.
- **Known limits:**
  - The index covers artwork, so reprints sharing art resolve to one representative printing. You can then swipe to yours.
  - Strong perspective (a card photographed at a steep angle) and very dark art held at more than ~6° can fail to match. They fail by not matching, not by matching wrong.
  - New sets need the index rebuilt.
  - Per-frame work is about 50 ms on a desktop, so expect roughly 2–4 matches per second on a phone.
  - Measurements come from Scryfall scans with simulated camera effects. Real photos of physical cards (print variation, sleeves, gloss) will score somewhat higher distances.

## File Structure
- `page.tsx`: thin route entry
- `CardScanner.tsx`: top-level state, data loading, URL sync, controls
- `CameraScanner.tsx`: camera lifecycle, guide overlay, index load, auto-scan loop, upload
- `autoScan.ts`: pure vote/decision rules for frames and photos
- `artIndex.ts`: index loading/decoding, nearest-artwork search, candidate merging
- `scanner.ts`: guide geometry, card placements (coarse/refine), motion/texture/sharpness, placement hashing
- `RecognitionStatus.tsx`, `ManualSearch.tsx`: recognition feedback and typed fallback
- `StorePrices.tsx`: per-store price tiles for the selected printing
- `CardViewport.tsx`, `PrintingCarousel.tsx`, `ComboList.tsx`: result views
- `scryfall.ts`, `combos.ts`: client fetchers for the internal API routes, formatting
- `types.ts`, `data.ts`: prototype types and tunable constants (with the measurements behind them)
- `lib/cards/art-hash.ts`: shared perceptual hashing (browser scanner and index builder)
- `scripts/build-card-art-index.ts`: builds `public/data/mtg-art-index.json`
- `app/api/card-scanner/{recognize,card/[oracleId],combos}/route.ts`, `lib/cards/*`: server routes and service wrappers
