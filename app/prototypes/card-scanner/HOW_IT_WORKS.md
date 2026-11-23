# Card Scanner

## What It Does
Identifies a Magic: The Gathering card automatically as soon as it is held steady in the camera frame, with no capture button (or from an uploaded photo, or a typed name), shows it as a tiltable 3D card using its Scryfall image, lets you swipe through every printing with set, rarity, finish, and daily prices, and lists the top three Commander Spellbook combos with an expandable full list.

Recognition is deliberately modest. It is OCR of the name line only. Foils, glare, steep angles, and stylized frames can miss. Low-confidence reads ask for confirmation, and misses offer suggestions plus manual search.

## Architecture
```text
 Camera (getUserMedia, rear)        Upload photo          Typed name
          |                              |                     |
  auto-scan loop, every 200 ms:          |                     |
   sample guide frame (36×50) + name band (160×14)            |
   steady? (frame diff < 8) and text? (band edges ≥ 5%)       |
   3 steady samples in a row ─┐    centered card crop          |
          +--------------+----+----------+                     |
                         v                                     |
          generous name band -> grayscale                      |
                 -> locate text line (max edge-mass row run)   |
                 -> contrast stretch, normal + inverted        |
                 -> Tesseract.js (single line, whitelist)      |
                 -> extractCandidates (<= 3)                   |
                         |                                     |
                         v                                     v
            POST /api/card-scanner/recognize  { candidates }
               Scryfall /cards/named?fuzzy  -> similarity score
               miss -> /cards/autocomplete on shrinking prefixes
                         |
          score >= 0.8 (or typed) ---> open card
          score <  0.8 -------------> "Is this X?" confirm + suggestions
                         |
                         v
       GET /api/card-scanner/card/:oracleId          GET /api/card-scanner/combos?oracleId&offset&limit
         Scryfall search oracleid:<id> unique=prints   Commander Spellbook /variants q=card:"<name>"
         (<= 5 pages, 100 ms apart)                    ordering=-popularity, filtered to the oracle id
                         |                                         |
                         v                                         v
            CardViewport + PrintingCarousel                     ComboList (3 -> all, paged by 20)

 lib/cards/http.ts: timeouts, size limit, 404/429/502/504 mapping, in-memory TTL cache + in-flight de-dupe
```

## Frontend / API
- **State** lives in `CardScanner`: recognition phase, card load state, printing index and slide direction, combo list state, and a reset signal for the 3D view.
- **Deep link:** `?card=<oracle id>&print=<scryfall id>` is written with `history.replaceState` and read after mount. No `useSearchParams`, so no Suspense boundary is needed and server/client first render match.
- **Camera:** it starts on tap, or automatically when the Permissions API reports camera access already granted. It asks for the rear camera (`facingMode: environment`) and stops all tracks on unmount (including a stream that arrives after unmount). Denied, unsupported/insecure-context, and failed-start states each have a message plus upload/typed fallbacks.
- **Auto-scan:** there is no capture button. While the camera is live and no result/confirmation/error is showing, a loop samples the guide frame every 200 ms.
  - OCR runs once 3 consecutive samples are steady and the name band has text-like edge density.
  - The OCR model is warmed as soon as the camera goes live.
  - Auto lookups are quiet: a miss leaves the UI untouched and retries after 700 ms.
  - The 3rd miss on the same scene surfaces the no-match panel with suggestions, then waits until the scene changes (frame diff > 18) before trying again. Pointing at an unreadable object therefore costs at most 3 lookups.
  - Low-confidence reads still pause on "Is this X?".
  - Overlay guidance: "Fit the card…" → "Hold steady…" (frame and band turn primary) → "Reading card name…" → "Couldn't read the name…".
  - All thresholds are in `data.ts`.
- **3D card:** CSS 3D (`perspective`, `transform-3d`, `backface-hidden`) driven by motion springs (stiffness 300, damping 30).
  - Drag tilts up to 22°. A horizontal drag over 80px switches printing on release.
  - Mouse hover tilts up to 8°. Gyroscope tilt is opt-in on touch devices (iOS permission requested on tap).
  - Double-faced printings get a Flip button and the **F** key. Arrow keys change printing when the card is focused.
  - Images use `object-contain` at the card's 63:88 ratio, so they are never cropped or distorted.
- **Reduced motion:** no hover or gyroscope tilt. Springs jump instead of animating, slides become fades, and skeleton pulses stop.
- **Printing carousel:** prev/next (44px), a scrollable set-code index, rarity/finish/date badges, and USD / USD foil / USD etched / EUR / EUR foil / MTGO prices. It notes that prices are Scryfall daily data and not a live quote, and links to Scryfall, TCGplayer, Cardmarket, and Cardhoarder.
- **Combos:** the first request fetches 3. "Show all combos" fetches from the API's next offset in pages of 20, with "Load more" while more remain and "Show top 3" to collapse. Each combo shows cards, results, requirements, steps, color identity, Commander legality, deck count, and a Commander Spellbook link.
- **Controls:** Scan (back to the camera), Reset (first printing, neutral 3D view, combos collapsed, status cleared), and Surprise me (random combo-heavy staple from `data.ts`).
- **API routes:**
  - `POST /recognize` takes up to 3 candidates of at most 80 chars each.
  - `GET /card/[oracleId]` validates the UUID.
  - `GET /combos` resolves the card name server-side, so clients can't send arbitrary upstream queries.
  - All routes return `{ error }` with 400/404/429/502/504/500 and never forward upstream bodies.
- **Caching:** card lookups and printings are cached for 10 minutes, combo pages for 1 hour, in process memory (300 entries max). Failures are not cached. Scryfall gets a descriptive User-Agent and 100ms between paged requests.

## AI Usage
No generative AI. On-device OCR runs through Tesseract.js (LSTM English model) in a Web Worker. No API keys are used.

## Key Dependencies
- Next.js 16 route handlers, React 19, motion (springs, `AnimatePresence`), lucide-react.
- `tesseract.js` 7. It is loaded on first scan via dynamic import. Its worker, wasm core, and `eng` traineddata come from the jsDelivr / tessdata CDNs (static assets, not an API) and are cached by the browser.
- Scryfall API (`/cards/named`, `/cards/autocomplete`, `/cards/search`). Card images load directly from `cards.scryfall.io` via `next/image` with `unoptimized`.
- Commander Spellbook API (`/variants`).
- Shared `Button`, `Badge`, `cn`, `useHydrated`, and semantic theme tokens.

## Component Tree
```text
page.tsx
└─ CardScanner                  state, fetch orchestration, URL sync
   ├─ CameraScanner             camera, auto-scan loop, upload, OCR   (scan view)
   ├─ RecognitionStatus         reading · resolving · confirm · no-match · error
   ├─ ManualSearch              typed name fallback
   ├─ CardViewport              3D card, tilt, swipe, flip, gyro, reset   (result view)
   ├─ PrintingCarousel          printing nav, set index, prices, links
   └─ ComboList → ComboItem     top 3 + expanded list
```

## Error Handling
- **Camera:** `NotAllowedError`/`SecurityError` show "blocked". No `mediaDevices` or an insecure context shows "needs HTTPS". `NotFoundError` shows "no camera". Anything else shows "couldn't start". Each has a retry, and Upload photo and typed search stay available.
- **OCR:** worker or canvas failures show a recoverable message and pause auto-scan until dismissed. Empty reads go to "no readable name". Low-similarity reads ask for confirmation with suggestions.
- **Network:** each lookup has its own `AbortController`, so stale responses are ignored. Card-load failures show Retry / Back to scanner. Combo failures show Retry without hiding the card.
- **Server:**
  - 8s timeouts (15s for Commander Spellbook), a 6 MB response cap, and defensive JSON readers (`obj/arr/str/num`).
  - Upstream 404/400 map to 404, 429 maps to 429, timeouts to 504, and other failures to 502.
  - Unknown errors return a generic 500.
- **Known limits:**
  - There is no automatic corner detection. The guide frame stands in for perspective correction; text-line localization tolerates a few percent of misalignment, but a card far smaller than the frame or well off-center will not read.
  - Uploaded photos assume the card roughly fills the image.
  - Printings are capped at 875 (shown as "N+").
  - Spellbook's name search is filtered to the exact oracle id, so a page can contain fewer than its size.

## File Structure
- `page.tsx`: thin route entry
- `CardScanner.tsx`: top-level state, data loading, URL sync, controls
- `CameraScanner.tsx`: camera lifecycle, guide overlay, auto-scan loop (steadiness + text detection), upload → OCR
- `RecognitionStatus.tsx`, `ManualSearch.tsx`: recognition feedback and typed fallback
- `CardViewport.tsx`: CSS 3D card with spring tilt, swipe, flip, gyroscope
- `PrintingCarousel.tsx`: printing navigation, set index, prices, attribution links
- `ComboList.tsx`: Commander Spellbook combos, expand/paginate
- `scanner.ts`: frame geometry, frame sampling/diff/edge density, text-line localization, preprocessing, Tesseract helpers, candidate extraction
- `scryfall.ts`, `combos.ts`: client fetchers for the internal API routes, price/label formatting
- `types.ts`, `data.ts`: prototype types and tunable constants
- `app/api/card-scanner/{recognize,card/[oracleId],combos}/route.ts`: server routes
- `lib/cards/{http,scryfall,commander-spellbook,match,types}.ts`: server-side service wrappers, cache, shared types
