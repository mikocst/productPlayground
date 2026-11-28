// Builds the whole-card hash index: public/data/card-index.<contenthash>.bin + card-index.manifest.json.
//
//   npx tsx scripts/build-card-index.ts              # every paper printing (~100k images; ~2 h the first time)
//   npx tsx scripts/build-card-index.ts --limit 3000 # quick iteration
//
// Source: Scryfall's "default_cards" bulk file. Whole-card hashes differ per printing (frame, border, text
// box), so this covers printings, not just unique artwork. Each face's `small` image is decoded and hashed in
// headless Chromium with lib/cards/card-hash.ts, the same decoder and code the phone runs.
//
// Downloads are cached outside the repo (CARD_INDEX_CACHE, default ~/.cache/card-scanner-index), so a rebuild
// after a hash change only re-hashes. Image fetches go through Scryfall's CDN with a modest concurrency cap.

import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { chromium } from "playwright";
import { hamming256, HASH_WORDS } from "../lib/cards/card-hash";
import { encodeIndex, type IndexName } from "../lib/cards/card-index";

const USER_AGENT = "PrototypePlayground/0.1 (card-scanner index builder)";
const OUT_DIR = path.join(process.cwd(), "public", "data");
const CACHE = process.env.CARD_INDEX_CACHE ?? path.join(os.homedir(), ".cache", "card-scanner-index");
const CONCURRENCY = 12;
const BATCH = 1000;
/**
 * Printings of one card whose hashes are this close are one "look" (same art and frame) and share an entry.
 * Kept tight on purpose: merging up to 16 bits saved 10% of the file but cut the eval's exact-printing rate
 * from 78% to 72%, because a camera hash still lands nearer the right one of two close looks more often than not.
 */
const MERGE_BITS = 2;
const SKIP_LAYOUTS = new Set(["token", "double_faced_token", "emblem", "art_series", "vanguard", "planar", "scheme", "reversible_card"]);
const SKIP_SET_TYPES = new Set(["token", "memorabilia", "minigame", "alchemy"]);

type Face = { id: string; oracleId: string; name: string; set: string; collector: string; released: string; url: string };

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

/** Downloads (or reuses) the bulk file for the current Scryfall update. */
async function bulkFile(): Promise<string> {
  const list = (await getJson("https://api.scryfall.com/bulk-data")) as { data: { type: string; updated_at: string; jsonl_download_uri?: string; download_uri?: string }[] };
  const bulk = list.data.find((item) => item.type === "default_cards");
  const uri = bulk?.jsonl_download_uri ?? bulk?.download_uri;
  if (!bulk || !uri) throw new Error("default_cards bulk file not found");
  const file = path.join(CACHE, `default_cards-${bulk.updated_at.replace(/[^0-9]/g, "")}${uri.endsWith(".gz") ? ".jsonl.gz" : path.extname(uri)}`);
  if (fs.existsSync(file)) return file;
  console.log(`Downloading ${uri}`);
  const response = await fetch(uri, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok || !response.body) throw new Error(`bulk download -> ${response.status}`);
  fs.mkdirSync(CACHE, { recursive: true });
  await fs.promises.writeFile(`${file}.part`, Readable.fromWeb(response.body as import("node:stream/web").ReadableStream));
  fs.renameSync(`${file}.part`, file);
  return file;
}

async function loadFaces(file: string): Promise<Face[]> {
  if (!file.includes(".jsonl")) throw new Error("expected a JSONL bulk file");
  let stream: NodeJS.ReadableStream = fs.createReadStream(file);
  if (file.endsWith(".gz")) stream = stream.pipe(zlib.createGunzip());
  const faces: Face[] = [];
  for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const card = JSON.parse(line) as Record<string, unknown>;
    const games = (card.games as string[] | undefined) ?? [];
    if (!games.includes("paper") || card.digital === true) continue;
    if (SKIP_LAYOUTS.has(String(card.layout)) || SKIP_SET_TYPES.has(String(card.set_type))) continue;
    if (card.image_status === "missing" || card.image_status === "placeholder") continue;
    const top = card.image_uris as Record<string, string> | undefined;
    const cardFaces = (card.card_faces as Record<string, unknown>[] | undefined) ?? [];
    const urls = top?.small ? [{ url: top.small, oracle: card.oracle_id }] : cardFaces.map((f) => ({ url: (f.image_uris as Record<string, string> | undefined)?.small, oracle: card.oracle_id ?? f.oracle_id }));
    for (const { url, oracle } of urls) {
      if (!url || !oracle) continue;
      faces.push({
        id: String(card.id),
        oracleId: String(oracle),
        name: String(card.name),
        set: String(card.set),
        collector: String(card.collector_number),
        released: String(card.released_at ?? ""),
        url,
      });
    }
    if (faces.length >= limit) break;
  }
  return faces.slice(0, limit);
}

const cachePath = (url: string) => {
  const key = createHash("sha1").update(url).digest("hex");
  return path.join(CACHE, "images", key.slice(0, 2), `${key}.jpg`);
};

/** Hashes already computed with this exact version of card-hash.ts, by image URL. */
function hashCache(): { file: string; hashes: Record<string, number[]> } {
  const version = createHash("sha256").update(fs.readFileSync(path.join(process.cwd(), "lib", "cards", "card-hash.ts"))).digest("hex").slice(0, 12);
  const file = path.join(CACHE, `hashes-${version}.json`);
  return { file, hashes: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {} };
}

async function main() {
  const faces = await loadFaces(await bulkFile());
  const cache = hashCache();
  console.log(`${faces.length} face images (${faces.filter((f) => cache.hashes[f.url]).length} already hashed; cache: ${CACHE})`);

  const bundle = await build({
    entryPoints: [path.join(process.cwd(), "lib", "cards", "card-hash.ts")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "CardHash",
    target: "es2020",
  });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  let downloaded = 0;
  // Serve Scryfall images from the disk cache; fetch (with our user agent) and store on a miss.
  await page.route("https://cards.scryfall.io/**", async (route) => {
    const file = cachePath(route.request().url());
    try {
      const body = await fs.promises.readFile(file);
      return route.fulfill({ status: 200, body, headers: { "content-type": "image/jpeg", "access-control-allow-origin": "*" } });
    } catch {
      // not cached
    }
    try {
      const response = await route.fetch({ headers: { ...route.request().headers(), "user-agent": USER_AGENT } });
      const body = await response.body();
      if (response.ok()) {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, body);
        downloaded++;
      }
      return route.fulfill({ response, body, headers: { ...response.headers(), "access-control-allow-origin": "*" } });
    } catch {
      return route.abort();
    }
  });
  await page.goto("about:blank");
  await page.addScriptTag({ content: "window.__name = (fn) => fn;" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const hashes: (number[] | null)[] = faces.map((face) => cache.hashes[face.url] ?? null);
  const todo = faces.map((_, i) => i).filter((i) => !hashes[i]);
  const started = Date.now();
  for (let start = 0; start < todo.length; start += BATCH) {
    const batch = todo.slice(start, start + BATCH);
    const urls = batch.map((i) => faces[i].url);
    const results = await page.evaluate(async ({ urls, concurrency }) => {
      type Lib = { hashCardPixels: (rgba: Uint8ClampedArray, w: number, h: number) => Uint32Array };
      const lib = (window as unknown as { CardHash: Lib }).CardHash;
      const out: (number[] | null)[] = new Array(urls.length).fill(null);
      let next = 0;
      async function work() {
        while (next < urls.length) {
          const i = next++;
          for (let attempt = 0; attempt < 2 && !out[i]; attempt++) {
            try {
              const response = await fetch(urls[i]);
              if (!response.ok) continue;
              const bitmap = await createImageBitmap(await response.blob());
              const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
              const context = canvas.getContext("2d", { willReadFrequently: true })!;
              context.drawImage(bitmap, 0, 0);
              const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
              out[i] = Array.from(lib.hashCardPixels(data, bitmap.width, bitmap.height));
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
    results.forEach((hash, k) => {
      hashes[batch[k]] = hash;
      if (hash) cache.hashes[faces[batch[k]].url] = hash;
    });
    const done = Math.min(todo.length, start + BATCH);
    const rate = done / ((Date.now() - started) / 1000);
    console.log(`${done}/${todo.length}  ${rate.toFixed(1)}/s  downloaded ${downloaded}  eta ${Math.round((todo.length - done) / rate / 60)} min`);
  }
  await browser.close();
  if (todo.length) fs.writeFileSync(cache.file, JSON.stringify(cache.hashes));

  // Group by card, newest printing first, merging printings that look the same.
  const order = faces.map((_, i) => i).filter((i) => hashes[i]).sort((a, b) => faces[b].released.localeCompare(faces[a].released));
  const byOracle = new Map<string, IndexName & { looks: Uint32Array[] }>();
  for (const i of order) {
    const face = faces[i];
    const hash = Uint32Array.from(hashes[i]!);
    let name = byOracle.get(face.oracleId);
    if (!name) {
      name = { name: face.name, oracleId: face.oracleId, entries: [], looks: [] };
      byOracle.set(face.oracleId, name);
    }
    const printing = { id: face.id, set: face.set, collector: face.collector };
    const look = name.looks.findIndex((h) => hamming256(h, 0, hash) <= MERGE_BITS);
    if (look >= 0) {
      const printings = name.entries[look].printings;
      if (!printings.some((p) => p.id === printing.id)) printings.push(printing);
    } else {
      name.looks.push(hash);
      name.entries.push({ hash, printings: [printing] });
    }
  }
  const names = [...byOracle.values()].sort((a, b) => a.name.localeCompare(b.name) || a.oracleId.localeCompare(b.oracleId));
  const today = new Date().toISOString().slice(0, 10);
  const newest = order.map((i) => faces[i]).find((face) => face.released <= today);
  const bytes = encodeIndex(names.map(({ name, oracleId, entries }) => ({ name, oracleId, entries })), Date.now(), newest?.set ?? "");

  const contentHash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const file = `card-index.${contentHash}.bin`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const old of fs.readdirSync(OUT_DIR)) if (/^card-index\.[0-9a-f]{16}\.bin$/.test(old) && old !== file) fs.rmSync(path.join(OUT_DIR, old));
  fs.writeFileSync(path.join(OUT_DIR, file), bytes);
  const entries = names.reduce((sum, n) => sum + n.entries.length, 0);
  const printings = names.reduce((sum, n) => sum + n.entries.reduce((s, e) => s + e.printings.length, 0), 0);
  const manifest = { file, version: 3, hashWords: HASH_WORDS, names: names.length, entries, printings, bytes: bytes.length, builtAt: new Date().toISOString(), newestSet: newest?.set ?? "", source: "Scryfall default_cards bulk data" };
  fs.writeFileSync(path.join(OUT_DIR, "card-index.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const failed = faces.length - order.length;
  console.log(`Wrote ${file}: ${names.length} cards, ${entries} looks, ${printings} printings, ${(bytes.length / 1e6).toFixed(2)} MB (${failed} images failed)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
