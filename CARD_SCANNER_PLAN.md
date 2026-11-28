# MTG 3D Card Scanner — Implementation Plan

## Goal
Build a mobile-first prototype that identifies a Magic: The Gathering card through the phone camera, renders it as a 3D card using its Scryfall art and frame imagery, browses every printing, shows prices, and presents top/expanded combo results from Commander Spellbook.

## MVP
1. Open the device rear camera and allow a clear card-capture frame.
2. Recognize the card name from the cropped card image.
3. Resolve the name through Scryfall and show a loading/error state for missed scans.
4. Render the card on a restrained 3D plane with tilt and orientation controls.
5. Swipe printings left/right and show set, collector number, rarity, finish, and prices.
6. Show the three most relevant combos containing the card.
7. Expand to the complete available combo list.
8. Support retry, manual card-name search, and visible privacy/camera errors.

## Recognition Pipeline
```text
Phone camera
  -> Crop / perspective correction
  -> Try on-device text recognition
  -> Candidate card-name extraction
  -> Server-side Scryfall fuzzy/exact lookup
  -> Oracle identity
  -> Prints lookup
  -> Commander Spellbook variant lookup
```

Recognition should be deliberately constrained:
- Read the name line first; OCR is the primary MVP signal.
- Do not claim perfect recognition for foils, foreshortened cards, glare, or stylized printings.
- If confidence is low or OCR returns multiple candidates, ask for a manual correction.
- Server routes should proxy Scryfall and Commander Spellbook instead of exposing third-party internals or bypassing rate limits.
- Cache repeated card identities and print lists for a short interval.

## Scryfall Integration
Use server-side routes only:
- `GET /cards/named?fuzzy=` for OCR-derived name lookup.
- Resolve `oracle_id` from the selected card.
- Use `prints_search_uri` or an API search query constrained by `oracleid:<id>&unique=prints`.
- Read `image_uris.normal`, `png`, or `art_crop` for the 3D card face.
- Read `set_name`, `set`, `collector_number`, `rarity`, `finishes`, `released_at`, and `prices` for the printing view.
- Preserve Scryfall and marketplace attribution and links.

Scryfall data is daily-priced and may be incomplete. Show the source and update time, and never imply that displayed prices are a live marketplace quote.

## Commander Spellbook Integration
Use the public API as documented at `https://backend.commanderspellbook.com/`:
- Search cards and variants by card name or identity.
- Filter or rank returned variants for relevance.
- Initial view: exactly three combos.
- Expanded view: all variants returned for the card, loaded lazily or paginated.
- Display combo components, prerequisite/result features, legality/status, popularity, and a link back to Commander Spellbook.
- Use its provided TypeScript client if it cleanly fits the project and does not hide API behavior.
- Credential-free requests remain subject to the API's rate limits; cache server-side and handle `429`.

Default ranking can initially use API-provided popularity/result ordering. The exact top-three algorithm should be documented before implementation, and a rank formula should be added only if needed.

## 3D Card View
MVP visual approach:
- Use a single card rectangle built from the Scryfall front image.
- Add subtle perspective and gyroscope/pointer tilt.
- Use a card-back plane only for cards that require a face flip or where no front image exists.
- Preserve original image proportions and never crop or distort the card artwork.
- Provide a reset-rotation control and reduce motion automatically.
- Desktop can use pointer drag; mobile uses touch drag and gyroscope when permission is granted.

Implementation choice:
- Start with CSS 3D transforms for speed and reliability.
- Promote to Three.js/R3F only if a real perspective effect, back-face rendering, lighting, or depth requires it.

## Printing Carousel
- Swipe and keyboard navigate printings.
- Show a small set index, set name, collector number, rarity, finish, and price.
- Add separate USD, foil USD, and EUR values when available.
- Keep the selected printing as a deep-link/query state where practical.
- Avoid live embedded iframes or loading full prototype apps in the gallery.

## Proposed Files
```text
app/prototypes/card-scanner/
  page.tsx
  metadata.json
  HOW_IT_WORKS.md
  types.ts
  data.ts
  CameraScanner.tsx
  CardViewport.tsx
  PrintingCarousel.tsx
  ComboList.tsx
  RecognitionStatus.tsx
  scanner.ts
  scryfall.ts
  combos.ts

app/api/card-scanner/
  recognize/route.ts
  card/[oracleId]/route.ts
  combos/route.ts

lib/cards/
  types.ts
  scryfall.ts
  commander-spellbook.ts
```

Shared UI can remain under `components/ui/`; third-party service wrappers should remain server-side.

## API Security and Caching
- Browser code never calls external APIs directly.
- Use short server caches for named-card and printing responses.
- Use longer caches for combo responses when Commander Spellbook updates are infrequent enough.
- Add server-side timeouts, response-size limits, and `429/502/504` handling.
- Return safe product-level errors; never leak upstream response bodies.
- Add no API keys unless Commander Spellbook or a future recognition service explicitly requires one.

## Recognition Options
Phase A: OCR-first MVP
- `getUserMedia` for rear-camera access.
- Canvas crop and image preprocessing.
- Browser-side OCR, then server-side Scryfall lookup.
- Lowest setup cost and fastest prototype speed.

Phase B: stronger recognition
- Evaluate TensorFlow.js or a hosted image-recognition model.
- OCR remains a fallback.
- Candidate ranking should combine name text, set logo, frame, and image similarity.

Camera/Machine-Learning packages should be added only after the basic OCR-first flow works.

## Implementation Phases
### Phase 1 — Card Search Foundation
- Manual name search.
- Scryfall card resolution and printing retrieval.
- Data normalization and error states.

### Phase 2 — Printing and Combo Views
- Swipeable printing carousel.
- Price/finish/set presentation.
- Commander Spellbook top-three plus expand behavior.

### Phase 3 — 3D View
- CSS 3D card, tilt, reset, and reduced-motion behavior.
- Face/back handling for compatible layouts.

### Phase 4 — Camera Recognition
- Camera permissions and mobile capture.
- Perspective crop and OCR.
- Candidate correction and manual fallback.

### Phase 5 — Hardening
- Cache, rate limiting, metrics, accessibility, and visual thumbnail capture.
- Test key layouts, recognition failures, no-camera devices, and API outages.

## Acceptance Criteria
- A user on a 375px viewport can open the rear camera and capture a card.
- A recognized card resolves to the correct Scryfall oracle identity.
- The initial result view shows a 3D/front card and the top three combos.
- Swiping moves between every available printing and updates set and price details.
- “Show all” reveals every available combo without hiding the current card.
- API outages and OCR misses are understandable and recoverable.
- All external card data and imagery retain attribution and source links.
- The prototype has metadata, documentation, thumbnails, reset behavior if tunable, and passes lint/type/build checks.

## Key Risks
- OCR accuracy: glossy surfaces, glare, rotation, and obscure fonts.
- Camera support: Safari permissions and secure-context requirements.
- Scryfall duplicate names: same-name cards and oracle versus printing identity.
- Combo completeness: upstream ranking or availability may differ over time.
- Image licensing/compliance: preserve attribution and do not alter full card images.
- Mobile performance: WebGL/OCR/camera streams can compete for memory and CPU.

## Libraries to Revisit
- Camera: native `MediaDevices.getUserMedia` first.
- OCR: Tesseract.js or platform OCR if later needed.
- 3D: CSS 3D first, Three.js/R3F only if necessary.
- Swipe: native pointer events or a maintained carousel library.
- Card recognition: model or hosted service only after OCR baseline is measured.
