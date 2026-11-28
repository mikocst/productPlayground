// Builds public/data/mtg-art-index.json: a perceptual hash of every unique paper Magic artwork on Scryfall.
//
//   npx tsx scripts/build-card-art-index.ts            # full index (~1 hour of polite image downloads)
//   npx tsx scripts/build-card-art-index.ts --limit 500
//
// Source: Scryfall's "unique_artwork" bulk file (https://scryfall.com/docs/api/bulk-data). Images come from
// Scryfall's image CDN (cards.scryfall.io), which is not rate limited, but downloads are kept modestly parallel.
// Hashing runs in headless Chromium using lib/cards/art-hash.ts so it matches the phone's hashing exactly.

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { chromium } from "playwright";

const USER_AGENT = "PrototypePlayground/0.1 (card-scanner art index builder)";
const OUT = path.join(process.cwd(), "public", "data", "mtg-art-index.json");
const CONCURRENCY = 12;
const WORDS = 4; // must match HASH_WORDS in lib/cards/art-hash.ts
const BATCH = 600;
const SKIP_LAYOUTS = new Set(["token", "double_faced_token", "emblem", "art_series", "vanguard", "planar", "scheme", "reversible_card"]);
const SKIP_SET_TYPES = new Set(["token", "memorabilia", "minigame", "alchemy"]);

type Entry = { id: string; oracleId: string; name: string; face: number; url: string };

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

async function loadArtworks(): Promise<Entry[]> {
  const list = (await getJson("https://api.scryfall.com/bulk-data")) as { data: { type: string; jsonl_download_uri?: string; download_uri?: string }[] };
  const bulk = list.data.find((item) => item.type === "unique_artwork");
  const uri = bulk?.jsonl_download_uri ?? bulk?.download_uri;
  if (!uri) throw new Error("unique_artwork bulk file not found");
  console.log(`Downloading ${uri}`);
  const response = await fetch(uri, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`bulk download -> ${response.status}`);
  const raw = Buffer.from(await response.arrayBuffer());
  const text = (uri.endsWith(".gz") ? zlib.gunzipSync(raw) : raw).toString("utf8");
  const cards: Record<string, unknown>[] = uri.includes(".jsonl")
    ? text.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : JSON.parse(text);

  const entries: Entry[] = [];
  for (const card of cards) {
    const games = (card.games as string[] | undefined) ?? [];
    if (!games.includes("paper") || card.digital === true) continue;
    if (SKIP_LAYOUTS.has(String(card.layout)) || SKIP_SET_TYPES.has(String(card.set_type))) continue;
    if (card.image_status === "missing" || card.image_status === "placeholder") continue;
    const faces = (card.card_faces as Record<string, unknown>[] | undefined) ?? [];
    const top = card.image_uris as Record<string, string> | undefined;
    const sources = top?.small
      ? [{ face: 0, url: top.small, oracle: card.oracle_id }]
      : faces.map((face, i) => ({ face: i, url: (face.image_uris as Record<string, string> | undefined)?.small, oracle: card.oracle_id ?? face.oracle_id }));
    for (const source of sources) {
      if (!source.url || !source.oracle) continue;
      entries.push({ id: String(card.id), oracleId: String(source.oracle), name: String(card.name), face: source.face, url: source.url });
    }
    if (entries.length >= limit) break;
  }
  return entries.slice(0, limit);
}

async function main() {
  const entries = await loadArtworks();
  console.log(`${entries.length} artwork images to hash`);

  const bundle = await build({
    entryPoints: [path.join(process.cwd(), "lib", "cards", "art-hash.ts")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "ArtHash",
    target: "es2020",
  });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("about:blank");
  // tsx keeps function names via an injected __name helper; give the page a no-op one.
  await page.addScriptTag({ content: "window.__name = (fn) => fn;" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const hashes = new Uint32Array(entries.length * WORDS);
  const ok = new Uint8Array(entries.length);
  const started = Date.now();
  for (let start = 0; start < entries.length; start += BATCH) {
    const urls = entries.slice(start, start + BATCH).map((entry) => entry.url);
    const results = await page.evaluate(async ({ urls, concurrency }) => {
      const out: (number[] | null)[] = new Array(urls.length).fill(null);
      const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      let next = 0;
      const lib = (window as unknown as { ArtHash: { hashCardImage: (c: CanvasRenderingContext2D, i: ImageBitmap) => number[] } }).ArtHash;
      async function work() {
        while (next < urls.length) {
          const i = next++;
          for (let attempt = 0; attempt < 2 && !out[i]; attempt++) {
            try {
              const response = await fetch(urls[i]);
              if (!response.ok) continue;
              const bitmap = await createImageBitmap(await response.blob());
              out[i] = lib.hashCardImage(context, bitmap);
              bitmap.close();
            } catch {
              // retried once, then skipped
            }
          }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, work));
      return out;
    }, { urls, concurrency: CONCURRENCY });
    results.forEach((hash, i) => {
      if (!hash) return;
      for (let w = 0; w < WORDS; w++) hashes[(start + i) * WORDS + w] = hash[w];
      ok[start + i] = 1;
    });
    const done = Math.min(entries.length, start + BATCH);
    const rate = done / ((Date.now() - started) / 1000);
    console.log(`${done}/${entries.length}  ${rate.toFixed(1)}/s  eta ${Math.round((entries.length - done) / rate / 60)} min`);
  }
  await browser.close();

  const kept = entries.map((entry, i) => ({ entry, i })).filter(({ i }) => ok[i]);
  const packed = new Uint32Array(kept.length * WORDS);
  kept.forEach(({ i }, k) => packed.set(hashes.subarray(i * WORDS, i * WORDS + WORDS), k * WORDS));
  const index = {
    version: 2,
    generatedAt: new Date().toISOString(),
    source: "Scryfall unique_artwork bulk data",
    count: kept.length,
    // 16 bytes per entry: little-endian uint32 [luma hi, luma lo, chroma hi, chroma lo].
    hashes: Buffer.from(packed.buffer).toString("base64"),
    // [scryfall printing id, oracle id, name, face index]
    cards: kept.map(({ entry }) => [entry.id, entry.oracleId, entry.name, entry.face]),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(index));
  console.log(`Wrote ${kept.length} entries (${entries.length - kept.length} failed) to ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
