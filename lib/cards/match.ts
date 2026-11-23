// Pure string helpers for comparing OCR output with resolved card names.

export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** 0..1 similarity between a candidate and a card name. Double-faced names match either face. */
export function nameSimilarity(candidate: string, cardName: string): number {
  const a = normalizeName(candidate);
  if (!a) return 0;
  const names = [cardName, ...cardName.split(" // ")].map(normalizeName).filter(Boolean);
  return Math.max(...names.map((b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length)));
}
