// Binary whole-card hash index ("CSIX" v3): every paper printing, grouped by card (oracle id), with
// identical-looking printings merged into one entry. Pure and dependency-free (builder, worker, eval).
//
// Layout, little-endian, every section 4-byte aligned:
//   header (32 bytes)  "CSIX" · u32 version · u32 hashWords · u32 entries · u32 names · u32 printings · f64 builtAt
//   string tables      names · set codes · collector numbers · [newest set code]   (u32 byteLength + UTF-8, "\n"-joined)
//   u8  [names × 16]           oracle id per name
//   u16 [names]                entry count per name (entries are contiguous by name)
//   u32 [entries × hashWords]  hashes
//   u16 [entries]              printing count per entry (printings are contiguous by entry)
//   u16 [printings × 2]        set index, collector index
//   u8  [printings × 16]       Scryfall printing id

import { HASH_WORDS, hamming256 } from "./card-hash";

export const INDEX_MAGIC = "CSIX";
export const INDEX_VERSION = 3;
const HEADER_BYTES = 32;

export type CardIndex = {
  entries: number;
  names: string[];
  oracleIds: Uint8Array;
  /** Entry range of each name: entries nameStart[n] … nameStart[n + 1] − 1. */
  nameStart: Uint32Array;
  /** Name of each entry. */
  entryName: Uint32Array;
  hashes: Uint32Array;
  /** Printing range of each entry. */
  printStart: Uint32Array;
  printSet: Uint16Array;
  printCollector: Uint16Array;
  sets: string[];
  collectors: string[];
  printIds: Uint8Array;
  builtAt: number;
  newestSet: string;
  bytes: number;
};

/** Builder input: one name with its distinct looks, each listing the printings that share it. */
export type IndexName = {
  name: string;
  oracleId: string;
  entries: { hash: ArrayLike<number>; printings: { id: string; set: string; collector: string }[] }[];
};

export type Hit = { entry: number; nameIndex: number; distance: number };
export type SearchResult = { best: Hit | null; runnerUp: Hit | null; nearest: Hit[] };

const pad4 = (n: number) => (n + 3) & ~3;

/** Set-bit count of every 16-bit value. */
const BITS = (() => {
  const table = new Uint8Array(65536);
  for (let i = 1; i < 65536; i++) table[i] = table[i >> 1] + (i & 1);
  return table;
})();

function uuidBytes(id: string, out: Uint8Array, offset: number) {
  const hex = id.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`bad uuid ${id}`);
  for (let i = 0; i < 16; i++) out[offset + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
}

export function uuidAt(bytes: Uint8Array, index: number): string {
  let hex = "";
  for (let i = index * 16; i < index * 16 + 16; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Serializes the index. Names keep the given order; entries and printings stay contiguous. */
export function encodeIndex(names: IndexName[], builtAt: number, newestSet: string): Uint8Array {
  const sets: string[] = [];
  const collectors: string[] = [];
  const setIdx = new Map<string, number>();
  const colIdx = new Map<string, number>();
  const intern = (map: Map<string, number>, list: string[], value: string) => {
    let i = map.get(value);
    if (i === undefined) {
      i = list.length;
      list.push(value);
      map.set(value, i);
    }
    return i;
  };
  let entries = 0;
  let printings = 0;
  for (const n of names) {
    if (n.entries.length > 0xffff) throw new Error(`too many entries for ${n.name}`);
    entries += n.entries.length;
    for (const e of n.entries) {
      if (e.printings.length > 0xffff) throw new Error("too many printings");
      printings += e.printings.length;
      for (const p of e.printings) {
        intern(setIdx, sets, p.set);
        intern(colIdx, collectors, p.collector);
      }
    }
  }
  if (sets.length > 0xffff || collectors.length > 0xffff) throw new Error("string table overflow");

  const encoder = new TextEncoder();
  const strings = [names.map((n) => n.name), sets, collectors, [newestSet]].map((list) => {
    if (list.some((s) => s.includes("\n"))) throw new Error("newline in string");
    return encoder.encode(list.join("\n"));
  });
  let size = HEADER_BYTES;
  for (const s of strings) size += 4 + pad4(s.length);
  size += names.length * 16 + pad4(names.length * 2) + entries * HASH_WORDS * 4 + pad4(entries * 2) + printings * 4 + printings * 16;

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(encoder.encode(INDEX_MAGIC), 0);
  view.setUint32(4, INDEX_VERSION, true);
  view.setUint32(8, HASH_WORDS, true);
  view.setUint32(12, entries, true);
  view.setUint32(16, names.length, true);
  view.setUint32(20, printings, true);
  view.setFloat64(24, builtAt, true);
  let o = HEADER_BYTES;
  for (const s of strings) {
    view.setUint32(o, s.length, true);
    out.set(s, o + 4);
    o += 4 + pad4(s.length);
  }
  names.forEach((n, i) => uuidBytes(n.oracleId, out, o + i * 16));
  o += names.length * 16;
  names.forEach((n, i) => view.setUint16(o + i * 2, n.entries.length, true));
  o += pad4(names.length * 2);
  for (const n of names) for (const e of n.entries) for (let w = 0; w < HASH_WORDS; w++, o += 4) view.setUint32(o, e.hash[w] >>> 0, true);
  let k = 0;
  for (const n of names) for (const e of n.entries) view.setUint16(o + 2 * k++, e.printings.length, true);
  o += pad4(entries * 2);
  for (const n of names) for (const e of n.entries) for (const p of e.printings) {
    view.setUint16(o, setIdx.get(p.set)!, true);
    view.setUint16(o + 2, colIdx.get(p.collector)!, true);
    o += 4;
  }
  k = 0;
  for (const n of names) for (const e of n.entries) for (const p of e.printings) uuidBytes(p.id, out, o + 16 * k++);
  o += printings * 16;
  if (o !== size) throw new Error("size mismatch");
  return out;
}

/** Parses and validates an index. Throws on any inconsistency, so a bad file fails closed. */
export function decodeIndex(buffer: ArrayBuffer): CardIndex {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const fail = (why: string): never => { throw new Error(`card index: ${why}`); };
  if (bytes.length < HEADER_BYTES) fail("truncated header");
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== INDEX_MAGIC) fail("bad magic");
  if (view.getUint32(4, true) !== INDEX_VERSION) fail("unsupported version");
  if (view.getUint32(8, true) !== HASH_WORDS) fail("hash size");
  const entries = view.getUint32(12, true);
  const nameCount = view.getUint32(16, true);
  const printings = view.getUint32(20, true);
  const builtAt = view.getFloat64(24, true);
  let o = HEADER_BYTES;
  const take = (length: number) => {
    if (o + length > bytes.length) fail("truncated");
    const start = o;
    o += pad4(length);
    return start;
  };
  const decoder = new TextDecoder();
  const strings = () => {
    if (o + 4 > bytes.length) fail("truncated");
    const length = view.getUint32(o, true);
    o += 4;
    const start = take(length);
    const text = decoder.decode(bytes.subarray(start, start + length));
    return text ? text.split("\n") : [];
  };
  const names = strings();
  const sets = strings();
  const collectors = strings();
  const newestSet = strings()[0] ?? "";
  if (names.length !== nameCount) fail("name count");

  // Copies (slice) so every typed array is aligned regardless of the source buffer.
  const section = (length: number) => {
    const start = take(length);
    return buffer.slice(start, start + length);
  };
  const oracleIds = new Uint8Array(section(nameCount * 16));
  const perName = new Uint16Array(section(nameCount * 2));
  const hashes = new Uint32Array(section(entries * HASH_WORDS * 4));
  const perEntry = new Uint16Array(section(entries * 2));
  const pairs = new Uint16Array(section(printings * 4));
  const printIds = new Uint8Array(section(printings * 16));
  if (o !== bytes.length) fail("trailing bytes");

  const nameStart = new Uint32Array(nameCount + 1);
  const entryName = new Uint32Array(entries);
  for (let n = 0, e = 0; n < nameCount; n++) {
    nameStart[n] = e;
    if (perName[n] === 0) fail("empty name");
    for (let k = 0; k < perName[n]; k++, e++) {
      if (e >= entries) fail("entry count");
      entryName[e] = n;
    }
    nameStart[n + 1] = e;
  }
  if (nameStart[nameCount] !== entries) fail("entry total");
  const printStart = new Uint32Array(entries + 1);
  for (let e = 0, p = 0; e < entries; e++) {
    printStart[e] = p;
    if (perEntry[e] === 0) fail("entry without printings");
    p += perEntry[e];
    printStart[e + 1] = p;
  }
  if (printStart[entries] !== printings) fail("printing total");
  const printSet = new Uint16Array(printings);
  const printCollector = new Uint16Array(printings);
  for (let p = 0; p < printings; p++) {
    printSet[p] = pairs[p * 2];
    printCollector[p] = pairs[p * 2 + 1];
    if (printSet[p] >= sets.length || printCollector[p] >= collectors.length) fail("string index");
  }
  return { entries, names, oracleIds, nameStart, entryName, hashes, printStart, printSet, printCollector, sets, collectors, printIds, builtAt, newestSet, bytes: bytes.length };
}

/**
 * Brute-force nearest entry, the nearest entry of a *different* card (runner-up), and optionally the
 * `nearest` closest entries. Entries are contiguous by name, so the runner-up needs no map: each name's
 * minimum is known when its run ends.
 */
export function search(index: CardIndex, hash: Uint32Array, nearest = 0): SearchResult {
  const { hashes, nameStart, entries } = index;
  const bits = BITS;
  const q0 = hash[0], q1 = hash[1], q2 = hash[2], q3 = hash[3], q4 = hash[4], q5 = hash[5], q6 = hash[6], q7 = hash[7];
  // Scalars, not objects, in the hot loop: best and runner-up are per name, so a name's minimum is folded in
  // when its run of entries ends.
  let bestD = 257, bestE = -1, bestN = -1;
  let secondD = 257, secondE = -1, secondN = -1;
  let name = 0, nameEnd = nameStart[1] ?? 0, nameD = 257, nameE = -1;
  const near: Hit[] = [];
  let nearCut = nearest > 0 ? 257 : -1;
  const fold = () => {
    if (nameD < bestD) {
      secondD = bestD; secondE = bestE; secondN = bestN;
      bestD = nameD; bestE = nameE; bestN = name;
    } else if (nameD < secondD) {
      secondD = nameD; secondE = nameE; secondN = name;
    }
  };
  for (let e = 0, o = 0; e < entries; e++, o += HASH_WORDS) {
    if (e === nameEnd) {
      fold();
      name++;
      nameEnd = nameStart[name + 1];
      nameD = 257;
    }
    // Inlined 16-bit-table popcount of the XOR: ~3× faster than calling hamming256 per entry.
    let x = hashes[o] ^ q0;
    let d = bits[x & 0xffff] + bits[x >>> 16];
    x = hashes[o + 1] ^ q1; d += bits[x & 0xffff] + bits[x >>> 16];
    x = hashes[o + 2] ^ q2; d += bits[x & 0xffff] + bits[x >>> 16];
    x = hashes[o + 3] ^ q3; d += bits[x & 0xffff] + bits[x >>> 16];
    x = hashes[o + 4] ^ q4; d += bits[x & 0xffff] + bits[x >>> 16];
    x = hashes[o + 5] ^ q5; d += bits[x & 0xffff] + bits[x >>> 16];
    x = hashes[o + 6] ^ q6; d += bits[x & 0xffff] + bits[x >>> 16];
    x = hashes[o + 7] ^ q7; d += bits[x & 0xffff] + bits[x >>> 16];
    if (d < nameD) {
      nameD = d;
      nameE = e;
    }
    if (d < nearCut) {
      near.push({ entry: e, nameIndex: name, distance: d });
      near.sort((a, b) => a.distance - b.distance);
      if (near.length > nearest) near.pop();
      if (near.length === nearest) nearCut = near[nearest - 1].distance;
    }
  }
  if (entries > 0) fold();
  return {
    best: bestE < 0 ? null : { entry: bestE, nameIndex: bestN, distance: bestD },
    runnerUp: secondE < 0 ? null : { entry: secondE, nameIndex: secondN, distance: secondD },
    nearest: near,
  };
}

/** Same as `search`, restricted to a few entries (refinement re-hashes against the earlier nearest K). */
export function searchEntries(index: CardIndex, hash: Uint32Array, entries: number[]): SearchResult {
  const byName = new Map<number, Hit>();
  const near: Hit[] = [];
  for (const entry of entries) {
    const hit = { entry, nameIndex: index.entryName[entry], distance: hamming256(index.hashes, entry * HASH_WORDS, hash) };
    near.push(hit);
    const known = byName.get(hit.nameIndex);
    if (!known || hit.distance < known.distance) byName.set(hit.nameIndex, hit);
  }
  const ranked = [...byName.values()].sort((a, b) => a.distance - b.distance);
  return { best: ranked[0] ?? null, runnerUp: ranked[1] ?? null, nearest: near.sort((a, b) => a.distance - b.distance) };
}

export type PrintingGuess = { printingId: string; set: string; collector: string; setCertain: boolean; certain: boolean };

/**
 * Which printing of an accepted card is in view. Every entry of that name within `spread` bits of the
 * best is a plausible look; if they all come from one set the set is certain, and if they also share a
 * collector number the printing is. Otherwise the closest entry's first (newest) printing is a guess.
 */
export function resolvePrinting(index: CardIndex, hash: Uint32Array, nameIndex: number, spread: number): PrintingGuess {
  let bestEntry = index.nameStart[nameIndex];
  let bestDistance = 257;
  const distances: [number, number][] = [];
  for (let e = index.nameStart[nameIndex]; e < index.nameStart[nameIndex + 1]; e++) {
    const d = hamming256(index.hashes, e * HASH_WORDS, hash);
    distances.push([e, d]);
    if (d < bestDistance) {
      bestDistance = d;
      bestEntry = e;
    }
  }
  const sets = new Set<number>();
  const prints = new Set<string>();
  for (const [e, d] of distances) {
    if (d > bestDistance + spread) continue;
    for (let p = index.printStart[e]; p < index.printStart[e + 1]; p++) {
      sets.add(index.printSet[p]);
      prints.add(`${index.printSet[p]}:${index.printCollector[p]}`);
    }
  }
  const p = index.printStart[bestEntry];
  return {
    printingId: uuidAt(index.printIds, p),
    set: index.sets[index.printSet[p]],
    collector: index.collectors[index.printCollector[p]],
    setCertain: sets.size === 1,
    certain: prints.size === 1,
  };
}

export function oracleIdOf(index: CardIndex, nameIndex: number): string {
  return uuidAt(index.oracleIds, nameIndex);
}
