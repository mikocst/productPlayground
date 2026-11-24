// Offline accuracy and timing for the card scanner, on the app's own modules in headless Chromium.
//
//   npx tsx scripts/eval-scanner.ts                 # synthetic set + real photos (if any), both engines
//   npx tsx scripts/eval-scanner.ts --cards 20 --engine v2 --modes live
//
// Synthetic frames: Scryfall `normal` scans (not the `small` images the index is built from) of seeded random
// printings plus borderless/old-frame cards, warped into 520×720 camera crops under several conditions,
// JPEG-compressed. Tokens (absent from the index) and empty tables are negatives.
// Real photos: put them in scripts/fixtures/scanner/ with fixtures.json, e.g.
//   [{ "file": "bolt-hand.jpg", "oracleId": "…", "printingId": "…" }, { "file": "goblin-token.jpg", "negative": true }]
//
// Reports, per engine and mode: correct / wrong opens, confirms, misses, exact-printing rate, frames to open,
// and ms per frame. Writes the full results to scripts/fixtures/scanner/last-eval.json (git-ignored).

import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import type { Condition } from "./eval/page";

const ROOT = process.cwd();
const CACHE = process.env.CARD_INDEX_CACHE ?? path.join(os.homedir(), ".cache", "card-scanner-index");
const FIXTURES = path.join(ROOT, "scripts", "fixtures", "scanner");
const ORIGIN = "http://eval.local";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const CARD_COUNT = Number(arg("cards", "36"));
const ENGINES = arg("engine", "v1,v2").split(",") as ("v1" | "v2")[];
const MODES = arg("modes", "hash,detect,live,photo").split(",");
const ONLY = arg("conditions", "");
const MAX_FRAMES = Number(arg("frames", "60"));
const SEED = Number(arg("seed", "42"));

const BASE: Omit<Condition, "name"> = { size: 0.92, rotate: 0, tilt: 0, offset: [0, 0], blur: 0, noise: 0, glare: 0, dim: 0, sleeve: false, busy: false };
export const CONDITIONS: Condition[] = [
  { ...BASE, name: "flat", rotate: 1, noise: 3 },
  { ...BASE, name: "handheld", size: 0.85, rotate: 6, tilt: 0.06, offset: [0.04, -0.03], blur: 0.7, noise: 6 },
  { ...BASE, name: "angled20", size: 0.85, rotate: 3, tilt: 0.16, blur: 0.5, noise: 5 },
  { ...BASE, name: "small", size: 0.62, rotate: -4, offset: [-0.05, 0.05], blur: 0.5, noise: 5 },
  { ...BASE, name: "glare", size: 0.88, rotate: 3, tilt: 0.05, blur: 0.5, noise: 5, glare: 0.6 },
  { ...BASE, name: "dim", size: 0.88, rotate: -3, blur: 1, noise: 10, dim: 0.5 },
  { ...BASE, name: "sleeve-busy", size: 0.86, rotate: 4, tilt: 0.05, blur: 0.5, noise: 5, sleeve: true, busy: true },
  { ...BASE, name: "angled30", size: 0.84, rotate: 5, tilt: 0.26, blur: 0.6, noise: 6 },
  { ...BASE, name: "blurry", size: 0.88, rotate: 3, blur: 2.2, noise: 8 },
  { ...BASE, name: "foil", size: 0.88, rotate: 2, tilt: 0.05, blur: 0.5, noise: 5, glare: 0.45, foil: 0.35 },
];

type Fixture = { url: string; oracleId: string | null; printingId: string | null; name: string; group: string };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Seeded sample of printings (and tokens as negatives) from the cached default_cards bulk file. */
async function pickFixtures(): Promise<Fixture[]> {
  const bulk = fs.readdirSync(CACHE).filter((f) => f.startsWith("default_cards-")).sort().pop();
  if (!bulk) throw new Error("Run scripts/build-card-index.ts first (it caches the bulk file).");
  const normal: Fixture[] = [], borderless: Fixture[] = [], old: Fixture[] = [], tokens: Fixture[] = [];
  const stream = fs.createReadStream(path.join(CACHE, bulk)).pipe(zlib.createGunzip());
  for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    if (!c.games?.includes("paper") || c.digital || c.lang !== "en" || !c.image_uris?.normal) continue;
    const f: Fixture = { url: c.image_uris.normal, oracleId: c.oracle_id, printingId: c.id, name: `${c.name} (${c.set} ${c.collector_number})`, group: "random" };
    if (c.layout === "token") tokens.push({ ...f, oracleId: null, printingId: null, group: "token" });
    else if (c.layout !== "normal" || ["memorabilia", "minigame", "alchemy", "token"].includes(c.set_type)) continue;
    else if (c.border_color === "borderless") borderless.push({ ...f, group: "borderless" });
    else if (c.frame === "1993" || c.frame === "1997") old.push({ ...f, group: "old-frame" });
    else normal.push(f);
  }
  const rand = rng(SEED);
  const take = (list: Fixture[], n: number) => {
    const out: Fixture[] = [];
    const copy = [...list];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
    return out;
  };
  const blank: Fixture = { url: "", oracleId: null, printingId: null, name: "(empty table)", group: "empty" };
  return [...take(normal, CARD_COUNT), ...take(borderless, 6), ...take(old, 6), ...take(tokens, 6), blank, blank];
}

function realFixtures(): Fixture[] {
  const file = path.join(FIXTURES, "fixtures.json");
  if (!fs.existsSync(file)) return [];
  const list = JSON.parse(fs.readFileSync(file, "utf8")) as { file: string; oracleId?: string; printingId?: string; negative?: boolean }[];
  return list.map((f) => ({ url: `${ORIGIN}/fixtures/${encodeURIComponent(f.file)}`, oracleId: f.negative ? null : f.oracleId ?? null, printingId: f.negative ? null : f.printingId ?? null, name: f.file, group: "real" }));
}

type Outcome = { kind: string; oracleId: string | null; printingId: string | null; frames: number; ms: number[] };
type Row = { engine: string; mode: string; condition: string; fixture: Fixture; outcome: Outcome };

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

function summarize(rows: Row[]) {
  const positives = rows.filter((r) => r.fixture.oracleId);
  const negatives = rows.filter((r) => !r.fixture.oracleId);
  const right = (r: Row) => r.outcome.oracleId === r.fixture.oracleId;
  const opens = positives.filter((r) => r.outcome.kind === "open");
  const correct = opens.filter(right);
  const exact = correct.filter((r) => r.outcome.printingId === r.fixture.printingId);
  const ms = rows.flatMap((r) => r.outcome.ms);
  return {
    n: positives.length,
    openCorrect: correct.length,
    openWrong: opens.length - correct.length,
    confirmCorrect: positives.filter((r) => r.outcome.kind === "confirm" && right(r)).length,
    confirmWrong: positives.filter((r) => r.outcome.kind === "confirm" && !right(r)).length,
    missed: positives.filter((r) => r.outcome.kind === "surface" || r.outcome.kind === "timeout").length,
    exactPrinting: exact.length,
    negatives: negatives.length,
    negativeOpened: negatives.filter((r) => r.outcome.kind === "open").length,
    negativeConfirm: negatives.filter((r) => r.outcome.kind === "confirm").length,
    framesToOpen: median(correct.map((r) => r.outcome.frames)),
    msMedian: median(ms),
    msP90: pct(ms, 0.9),
  };
}

async function main() {
  if (ONLY) CONDITIONS.splice(0, CONDITIONS.length, ...CONDITIONS.filter((c) => ONLY.split(",").includes(c.name)));
  const fixtures = await pickFixtures();
  const real = realFixtures();
  console.log(`${fixtures.length} synthetic fixtures × ${CONDITIONS.length} conditions, ${real.length} real photos; engines ${ENGINES.join(", ")}; modes ${MODES.join(", ")}`);

  const bundle = await build({ entryPoints: [path.join(ROOT, "scripts", "eval", "page.ts")], bundle: true, write: false, format: "iife", globalName: "Eval", target: "es2022" });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>eval</title>" });
    const file = url.pathname.startsWith("/fixtures/") ? path.join(FIXTURES, decodeURIComponent(url.pathname.slice(10))) : path.join(ROOT, "public", url.pathname);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ body: fs.readFileSync(file) });
  });
  // Scryfall images: same disk cache as the index builder.
  await page.route("https://cards.scryfall.io/**", async (route) => {
    const key = createHash("sha1").update(route.request().url()).digest("hex");
    const file = path.join(CACHE, "images", key.slice(0, 2), `${key}.jpg`);
    if (fs.existsSync(file)) return route.fulfill({ body: fs.readFileSync(file), headers: { "access-control-allow-origin": "*", "content-type": "image/jpeg" } });
    const response = await route.fetch({ headers: { "user-agent": "PrototypePlayground/0.1 (card-scanner eval)" } });
    const body = await response.body();
    if (response.ok()) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
    return route.fulfill({ response, body, headers: { ...response.headers(), "access-control-allow-origin": "*" } });
  });
  await page.goto(`${ORIGIN}/`);
  await page.addScriptTag({ content: "window.__name = (fn) => fn;" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const loaded = await page.evaluate(() => (window as unknown as { Eval: typeof import("./eval/page") }).Eval.load());
  console.log(`index: ${loaded.entries} entries, ${loaded.names} cards, ${(loaded.bytes / 1e6).toFixed(2)} MB, parsed in ${loaded.parseMs.toFixed(0)} ms`);
  for (const f of fixtures) if (f.url) await page.evaluate((url) => (window as unknown as { Eval: typeof import("./eval/page") }).Eval.image(url), f.url);

  type E = typeof import("./eval/page");
  const rows: Row[] = [];
  const report: Record<string, unknown> = { loaded };

  if (MODES.includes("hash")) {
    const cards = fixtures.filter((f) => f.oracleId);
    let ok = 0;
    const margins: number[] = [];
    const distances: number[] = [];
    for (const f of cards) {
      const r = await page.evaluate((url) => (window as unknown as { Eval: E }).Eval.hashOnly(url), f.url);
      distances.push(r.distance);
      margins.push(r.runnerUp - r.distance);
      if (r.oracleId === f.oracleId) ok++;
      else console.log(`  hash miss: ${f.name} → ${r.name} (${r.distance})`);
    }
    report.hash = { cards: cards.length, correctName: ok, medianDistance: median(distances), minMargin: Math.min(...margins), medianMargin: median(margins) };
    console.log(`\nhash only (clean normal scans, image-corner quad): ${ok}/${cards.length} correct name, median distance ${median(distances)}, median margin ${median(margins)}, min margin ${Math.min(...margins)}`);
  }

  if (MODES.includes("detect")) {
    const byCondition: Record<string, { hits: number; n: number; errors: number[]; ms: number[] }> = {};
    for (const c of CONDITIONS) {
      const stat = (byCondition[c.name] = { hits: 0, n: 0, errors: [] as number[], ms: [] as number[] });
      for (const [i, f] of fixtures.entries()) {
        if (!f.oracleId) continue;
        const r = await page.evaluate(async ([url, cond, seed]) => {
          const ev = (window as unknown as { Eval: E }).Eval;
          return ev.detection(await ev.jpeg(ev.render(url as string, cond as Condition, seed as number, 0.004)));
        }, [f.url, c, SEED + i] as const);
        stat.n++;
        if (r.hit) stat.hits++;
        if (r.error !== null) stat.errors.push(r.error);
        stat.ms.push(r.ms);
      }
    }
    report.detect = byCondition;
    console.log("\ndetection alone (any outline within 3% of the true corners):");
    for (const [name, s] of Object.entries(byCondition)) console.log(`  ${name.padEnd(12)} ${s.hits}/${s.n}  median error ${(median(s.errors) * 100).toFixed(1)}%  ${median(s.ms).toFixed(1)} ms`);
  }

  if (MODES.includes("sweep")) {
    type P = import("./eval/page").FramePoint;
    const points: P[] = [];
    for (const c of CONDITIONS) {
      for (const [i, f] of fixtures.entries()) {
        points.push(...(await page.evaluate(async ([url, oracle, printing, cond, seed]) => (window as unknown as { Eval: E }).Eval.frames((url as string) || null, oracle as string | null, printing as string | null, cond as Condition, seed as number, 8), [f.url, f.oracleId, f.printingId, c, SEED + i] as const)));
      }
    }
    const pos = points.filter((p) => !p.negative);
    const bad = points.filter((p) => p.negative || !p.correct);
    console.log(`
sweep: ${pos.length} card frames (${pos.filter((p) => p.correct).length} with the right card best), ${points.filter((p) => p.negative).length} negative frames`);
    const closestBad = [...bad].sort((a, b) => a.distance - b.distance).slice(0, 8);
    console.log("closest wrong/negative frames (distance, margin):", closestBad.map((p) => `${p.distance}/${p.margin}${p.negative ? "n" : "w"}`).join(" "));
    const good = pos.filter((p) => p.correct).map((p) => p.distance).sort((a, b) => a - b);
    console.log(`right-card distance: median ${median(good)}, p90 ${pct(good, 0.9)}, p99 ${pct(good, 0.99)}, max ${good[good.length - 1]}`);
    console.log("confident-frame rate (right card) / wrong confident frames, by distance × margin:");
    console.log("dist\margin	" + [6, 8, 10, 12, 16].join("	"));
    for (const d of [40, 44, 48, 52, 56, 60, 64, 72]) {
      const cells = [6, 8, 10, 12, 16].map((m) => {
        const tp = pos.filter((p) => p.correct && p.distance <= d && p.margin >= m).length;
        const fp = bad.filter((p) => p.distance <= d && p.margin >= m).length;
        return `${((tp / pos.length) * 100).toFixed(0)}%/${fp}`;
      });
      console.log(`${d}		${cells.join("	")}`);
    }
    report.sweep = points;
  }

  for (const engine of ENGINES) {
    for (const mode of ["live", "photo"].filter((m) => MODES.includes(m))) {
      for (const c of CONDITIONS) {
        for (const [i, f] of fixtures.entries()) {
          const outcome = await page.evaluate(async ([url, cond, seed, frames, eng, m]) => {
            const ev = (window as unknown as { Eval: E }).Eval;
            return m === "live" ? ev.live((url as string) || null, cond as Condition, seed as number, frames as number, eng as "v1" | "v2") : ev.photo((url as string) || null, cond as Condition, seed as number, eng as "v1" | "v2");
          }, [f.url, c, SEED + i, MAX_FRAMES, engine, mode] as const);
          rows.push({ engine, mode, condition: c.name, fixture: f, outcome });
        }
      }
      for (const f of real) {
        const r = await page.evaluate(async ([url, eng, frames]) => (window as unknown as { Eval: E }).Eval.realPhoto(url as string, eng as "v1" | "v2", frames as number), [f.url, engine, MAX_FRAMES] as const);
        rows.push({ engine, mode, condition: "real", fixture: f, outcome: mode === "live" ? r.live : r.photo });
      }
    }
  }
  await browser.close();

  const table: Record<string, unknown>[] = [];
  for (const engine of ENGINES) {
    for (const mode of ["live", "photo"]) {
      const subset = rows.filter((r) => r.engine === engine && r.mode === mode);
      if (!subset.length) continue;
      for (const condition of [...CONDITIONS.map((c) => c.name), "real", "all"]) {
        const part = condition === "all" ? subset.filter((r) => r.condition !== "real") : subset.filter((r) => r.condition === condition);
        if (!part.length) continue;
        table.push({ engine, mode, condition, ...summarize(part) });
      }
    }
  }
  console.log("\n" + ["engine", "mode", "condition", "open ok", "open WRONG", "confirm ok", "confirm wrong", "missed", "exact print", "neg opened", "frames→open", "ms med", "ms p90"].join("\t"));
  for (const t of table) {
    const s = t as ReturnType<typeof summarize> & { engine: string; mode: string; condition: string };
    console.log([s.engine, s.mode, s.condition.padEnd(11), `${s.openCorrect}/${s.n}`, s.openWrong, s.confirmCorrect, s.confirmWrong, s.missed, `${s.exactPrinting}/${s.openCorrect}`, `${s.negativeOpened}/${s.negatives}`, s.framesToOpen, s.msMedian.toFixed(1), s.msP90.toFixed(1)].join("\t"));
  }
  const wrong = rows.filter((r) => (r.outcome.kind === "open" && r.outcome.oracleId !== r.fixture.oracleId));
  if (wrong.length) {
    console.log("\nwrong opens:");
    for (const r of wrong) console.log(`  ${r.engine} ${r.mode} ${r.condition}: ${r.fixture.name} → ${r.outcome.oracleId}`);
  }
  fs.mkdirSync(FIXTURES, { recursive: true });
  fs.writeFileSync(path.join(FIXTURES, "last-eval.json"), JSON.stringify({ report, table, rows }, null, 1));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
