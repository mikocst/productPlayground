# Card scanner photo fixtures

Real phone photos for `scripts/eval-scanner.ts`. The synthetic set the eval generates is useful for
regressions, but only real photos (print variation, sleeves, gloss, foils, your lighting) say how the
scanner does in practice.

## Adding photos

1. Take about 30 of your own cards, with three shots each:
   - flat on a table;
   - held in hand;
   - angled about 20°.
2. Include a few foils, a borderless card, two reprints that share art, and 3 tokens as negatives.
3. Save the photos here (JPEG or PNG). Then list them in `fixtures.json`, with the card's Scryfall oracle id
   and printing id from the card's Scryfall page:

```json
[
  { "file": "counterspell-flat.jpg", "oracleId": "…", "printingId": "…" },
  { "file": "counterspell-hand.jpg", "oracleId": "…", "printingId": "…" },
  { "file": "goblin-token.jpg", "negative": true }
]
```

4. Run `npx tsx scripts/eval-scanner.ts --modes live,photo`. Each photo runs through the upload path, and
   then as 60 live frames with fresh sensor noise. Results are printed under the `real` condition.

`last-eval.json` (the full results of the last run) is git-ignored.
