# Goldfish Tester

## What It Does
A free goldfish tester for any Commander deck. It measures how fast the deck executes its win when nobody
interacts. It grows out of the Vivi Goldfish Simulator: the same seeded engine and kill-turn histogram,
generalised so any decklist and any game plan can drive it.

It is a pure goldfish: no opponent and no interaction. Counterspells and removal sit in hand as dead cards,
which shows what those slots cost in speed. Each game reports two numbers:
- **Executed turn** (the headline): the first turn the deck has every piece of a counting win condition *and* the mana to use it.
- **Assembled turn**: the first turn all the pieces were present. The gap between the two shows whether the deck is short on pieces or short on mana.

The page shows, top to bottom:
- **Executed turn**: median executed turn, share won by the target turn, the average assembled-to-executed gap, and a histogram. Bars are rose before the target, gold on it, blue after, slate for "no win by the cap". A dashed ghost above each bar counts games that assembled on that turn but executed later. Bars have a hover/focus tooltip and a table view. Run settings sit beside the chart on desktop and stack below it on mobile: games, play/draw, a 10 or 12 turn cap, and a seed, plus Run, Reset, Surprise me (random seed) and Copy share link.
- **Which line won**: the share of wins per win condition.
- **Watch one game**: a seeded sample game played back a turn at a time, with a skip control. Assembly is a quiet italic beat that names the mana shortfall; the win is a gold line the log scrolls to.
- **Setup**, in three tabs:
  - **Deck**: Archidekt link import, the decklist textarea, a deck check (card count, commander) with a commander picker, the imported primer, and problem flags with fixes.
  - **Win conditions**: Commander Spellbook combos plus custom ones, each set to Counts or Ignored.
  - **Game plan**: the guided primer form.

The Vivi deck loads as the demo, from baked card data, so a visitor sees results with no lookups.
A shared link (`#s=…`) holds the deck, commander choice, card fixes, combo states, custom win conditions,
plan and run settings, and reproduces the same histogram in a fresh browser.

## ASCII Architecture
```text
 browser
   Deck text ──┐            Archidekt link ─▶ GET /api/goldfish-tester/import ─▶ DeckLine[] (+ primer)
               ▼
   parse.ts  "1 Sol Ring" · "1x …" · "1 Sol Ring (CMR) 472 *F*" · Commander/Deck/Sideboard headers
               ▼
   POST /api/goldfish-tester/resolve ─▶ Scryfall: /cards/collection (75 per batch, set+number or name)
                                        → /cards/named?fuzzy= for misses (typos, reflavored names)
                                        → /cards/autocomplete suggestions for what still misses
               ▼
   deck.ts + classify.ts   every card keyed by oracle_id; role = user fix ▸ curated registry ▸ auto/guess
               ▼                                     problem flags: Not found (blocks) · Auto-guessed · Unmodelled
   POST /api/goldfish-tester/combos ─▶ Commander Spellbook find-my-combos (no CORS, so proxied)
               ▼
   wins.ts   builtin Damage + custom + Spellbook → WinCondition[] (counts | ignored)
   plan.ts   auto-drafted GamePlan (Vivi preset adds its commander hook), edited by PrimerForm
               ▼
   compose.ts ─▶ { SimDeck, GamePlan } ─▶ useSimulator ─▶ sim.worker.ts ─▶ runner.ts ─▶ engine.ts
                                                                    RunSummary / GameResult ◀─┘
   share.ts   setup → JSON → deflate-raw (CompressionStream) → base64url → URL hash
```

**Engine (engine.ts)**, per game:
1. Shuffle with `mulberry32` (one RNG shared across a run, so a seed reproduces every game). Mulligan when the hand's land count falls outside the plan's range, or it lacks a must-see role. The first mulligan is free; the second bottoms the lowest-scoring card.
2. Each turn: upkeep draw engines, upkeep hooks, the draw step (none on turn 1 on the play), then a land (or a landcycler, paying 1).
3. Loop, capped at 90 steps: check win conditions, then take the first legal pilot rule. The rules are the plan's priorities, with the commander rule inserted first (`asap`) or after the rock rule (`afterRamp`).
4. End of turn: flash in battlefield pieces (Hullbreaker Horror), then exile the impulse cards that weren't played.

- **Pieces**: a win condition's pieces fill from the battlefield first (free), then the command zone, then the hand. A piece not yet on the battlefield costs its mana value. `manaNeeded` is extra mana beyond that.
- **Assembled and executed**: a condition is *assembled* when its pieces and `requires` conditions are met, and *executed* when there is also enough mana. The first time a condition assembles without the mana, the log notes the shortfall ("needs 7 mana, have 5").
- **Card selection** (`score()`, kept from the Vivi sim): 100 for the last missing piece of a counting win condition, 60 for other missing pieces. After that, the plan's look-for list, then tutors, lands while short, rocks early, and so on. Ignored win conditions drive no tutoring or selection.
- **Commander engine**: `EngineHook`s fire on `spellCast`, `landPlayed`, `upkeep` and `creatureEnters`. Vivi is `spellCast (noncreature) → addCounter, damageEachOpponent 1, drawPerAmplifier 3`, plus `manaFromCounters` for its {0} ability.

**Parity with the Vivi sim** (`npx tsx scripts/goldfish-parity.ts`, 5000 games, seed 1126):

| Turn order | Engine | Median executed turn | Turn shares |
| --- | --- | --- | --- |
| On the play | Vivi sim | T6 | T4 4.5%, T5 22.1%, T6 23.9%, none 17.4% |
| On the play | This engine | T6 | T4 3.9%, T5 21.4%, T6 23.9%, none 18.9% |
| On the draw | Vivi sim | T6 | T5 29.5%, T6 23.7%, none 14.6% |
| On the draw | This engine | T6 | T5 26.8%, T6 26.1%, none 14.8% |

The median matches and every turn's share is within about 3 points, so phase 3's gate ("matches the median kill turn within noise") passes. The engine is the generalised one rather than a verbatim port, so phase 1's exact-histogram gate does not apply to it. The script runs the original `sim()` from the HTML file alongside it, which keeps the known-good baseline.

## Frontend/API
- `/prototypes/goldfish-tester`: a single client page (`GoldfishTester`). State lives in `useGoldfish`; composing the setup is pure (`compose.ts`).
- `POST /api/goldfish-tester/resolve` `{ lines: [{ name, set?, collectorNumber? }] }` (1–250 lines) → `{ cards: (CardData|null)[], misses: [{ query, suggestions }] }`.
  - Requests are spaced 120 ms apart; fuzzy lookups are capped at 25 per request.
  - Resolved cards are cached in memory for a day.
- `POST /api/goldfish-tester/combos` `{ commanders: string[], main: string[] }` (≤150 names) → `{ included: SpellbookCombo[], almostIncluded }`.
  - Up to 3 pages of 100; cached for an hour by the sorted card list.
- `GET /api/goldfish-tester/import?url=` → `{ lines, title?, primer? }`.
  - Only Archidekt (`archidekt.com/decks/<id>`); the server builds the upstream URL from the id alone.
  - Moxfield answers 422 with "Moxfield doesn't allow imports. Use Export → Plain Text and paste it here."
- Card data comes from Scryfall through these routes. The plan's daily bulk index on a CDN is not built yet: the playground already has a server, so the collection endpoint (2 requests for 100 cards) stands in for it.
- localStorage: `goldfish-tester:fixes:v1` stores role fixes by `oracle_id`, so they carry into every deck. `goldfish-tester:v1` remembers the last loaded deck. Both are read after mount.

## AI Usage
None. The plan's optional LLM primer import (a freeform primer compiled into form values with the user's own key) is a later phase. An imported Archidekt primer is shown as text beside the guided form.

## Key Dependencies
- `motion` for the tab pill, switch thumb, playback reveals and reduced-motion detection.
- Shared `components/ui`: `Button`, `Badge`, and the AsterMotion `Switch` and `Tabs` (added here, adapted to controlled APIs).
- Browser `Worker`, and `CompressionStream`/`DecompressionStream` (`deflate-raw`) for share links, used instead of lz-string to avoid a dependency.
- Upstream: Scryfall API, Commander Spellbook API, Archidekt deck API.

## Component Tree
```text
page.tsx
└─ GoldfishTester (useGoldfish → useSimulator → sim.worker)
   ├─ ResultsWindow ─ Tile ×2 · Histogram · RunControls (Segmented)
   ├─ LinesWindow
   ├─ SampleGame ─ Playback
   ├─ Window "Setup" ─ Tabs
   │  ├─ DeckPanel ─ CardList ─ Entry ─ RolePicker
   │  ├─ WinConditionsPanel ─ WinRow (Switch) · CustomWinForm
   │  └─ PrimerForm ─ Question ×6 (Chips, Segmented)
   └─ details "What the simulator assumes"
```

## Error Handling
- Route handlers validate input (counts, lengths, set/number shapes) and return 400 for bad input.
- Upstream failures map to 404, 422, 429, 502 or 504 with product messages. Upstream bodies are never forwarded.
- Not found cards block Run until each is replaced with a suggestion or removed. Auto-guessed and Unmodelled cards never block.
- A failed Spellbook call shows Retry; the deck still runs on builtin and custom win conditions.
- Worker errors reject the pending run and recreate the worker on the next call.
- Hash decoding validates every field, and a bad hash falls back to the demo.
- Every localStorage access is wrapped in try/catch.
- Reduced motion: playback shows the whole game at once, and the bar transitions and reveals are disabled.

## Known gaps
- The resolver never raises the **Ambiguous** flag, because Scryfall always returns one card per lookup. The flag and its UI are in place for when a slim index can match one name to several cards.
- Zur the Enchanter's attack trigger (search for an enchantment) has no event in the hook model (`attack` isn't one), so the Zur deck runs only as a generic commander deck. Gate 4 still passes: it runs from an auto-drafted plan with no hand-written code.
- Mana colours are ignored, mana dorks tap the turn they come down, and Spellbook prerequisites written as prose (for example "Permanent Castable for {C}") are listed for review rather than enforced.

## File Structure
```text
app/prototypes/goldfish-tester/
  page.tsx · metadata.json · HOW_IT_WORKS.md
  types.ts        shared data types (DeckLine, CardData, Role, WinCondition, GamePlan, RunSummary …)
  config.ts       constants, role labels, storage keys
  rng.ts          mulberry32
  parse.ts        decklist text parser
  registry.ts     curated roles (the Vivi sim's DB table)
  classify.ts     automatic roles and guesses; describeRole
  deck.ts         lines + card data + fixes → SimDeck, problem flags, deck check
  wins.ts         builtin/Spellbook/custom win conditions; Vivi presets; de-duplication
  plan.ts         auto-drafted plan, Vivi preset, rule descriptions
  compose.ts      setup → { deck, plan }; baked demo resolution
  engine.ts       one seeded game
  runner.ts       many games → RunSummary; sample games
  sim.worker.ts   worker entry
  api.ts · share.ts · storage.ts · useSimulator.ts · useGoldfish.ts
  demoDeck.ts · demoCards.json (baked by scripts/build-goldfish-demo.ts)
  GoldfishTester · Window · Segmented · ResultsWindow · Histogram · RunControls · LinesWindow · SampleGame
  DeckPanel · CardList · RolePicker · WinConditionsPanel · CustomWinForm · PrimerForm (.tsx)
app/api/goldfish-tester/{resolve,combos,import}/route.ts
lib/goldfish/{http,scryfall,spellbook,archidekt}.ts      server-only upstream clients
components/ui/{switch,tabs}.tsx                           AsterMotion components, shared
scripts/build-goldfish-demo.ts · scripts/goldfish-parity.ts
```
