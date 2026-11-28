// Decklist text parser. Every import route ends here, so pasted text is the path that always works.
// Accepts "1 Sol Ring", "1x Sol Ring", Moxfield/Archidekt "1 Sol Ring (CMR) 472 *F*" and section headers.

import type { DeckLine, Section } from "./types";

const HEADERS: Record<string, Section> = {
  commander: "commander", commanders: "commander", "command zone": "commander",
  deck: "deck", main: "deck", mainboard: "deck", maindeck: "deck", library: "deck", companion: "sideboard",
  sideboard: "sideboard", maybeboard: "sideboard", considering: "sideboard", maybe: "sideboard", tokens: "sideboard",
};

function header(line: string): Section | null {
  const key = line.replace(/^\/\/\s*/, "").replace(/[:\s]+$/, "").replace(/\s*\(\d+\)$/, "").trim().toLowerCase();
  return HEADERS[key] ?? null;
}

/** Archidekt-style "[Commander{top}]" or "[Ramp,Maybeboard]" category tags. */
function categorySection(tags: string): Section | null {
  const t = tags.toLowerCase();
  if (/\bcommander\b/.test(t)) return "commander";
  if (/\b(maybeboard|sideboard|considering)\b/.test(t)) return "sideboard";
  return null;
}

export function parseDecklist(text: string): DeckLine[] {
  const out: DeckLine[] = [];
  let section: Section = "deck";
  let sawHeader = false;
  let block = 0;
  const blockOf: number[] = [];

  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) { block++; continue; }
    const h = header(line);
    if (h) { section = h; sawHeader = true; continue; }
    if (line.startsWith("#") || line.startsWith("//")) continue;

    let lineSection: Section = section;
    const tag = line.match(/\[([^\]]*)\]/);
    if (tag) {
      lineSection = categorySection(tag[1]) ?? lineSection;
      line = line.replace(/\[[^\]]*\]/g, " ");
    }
    if (/\*CMDR\*/i.test(line)) lineSection = "commander";
    // Foil/etched markers, Archidekt colour tags, Moxfield "#tag"s.
    line = line.replace(/\*[A-Z]+\*/gi, " ").replace(/\^[^^]*\^/g, " ").replace(/\s#\S+/g, " ").trim();

    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const qty = m ? Math.max(1, Math.min(99, Number(m[1]))) : 1;
    let name = (m ? m[2] : line).trim();
    let set: string | undefined;
    let collectorNumber: string | undefined;
    const printing = name.match(/^(.*?)\s+\(([A-Za-z0-9]{2,6})\)\s*([\w★-]+)?\s*$/);
    if (printing) {
      name = printing[1].trim();
      set = printing[2].toLowerCase();
      collectorNumber = printing[3];
    }
    if (!name) continue;
    out.push({ qty, name, section: lineSection, ...(set ? { set } : {}), ...(collectorNumber ? { collectorNumber } : {}) });
    blockOf.push(block);
  }

  // No headers: a short final block after a blank line is the usual place for the commander.
  if (!sawHeader && !out.some((l) => l.section === "commander")) {
    const last = blockOf[blockOf.length - 1];
    const count = blockOf.filter((b) => b === last).length;
    if (last > blockOf[0] && count <= 2) out.forEach((l, i) => { if (blockOf[i] === last) l.trailing = true; });
  }
  return out;
}

export function lineKey(l: Pick<DeckLine, "name">): string {
  return l.name.trim().toLowerCase();
}
