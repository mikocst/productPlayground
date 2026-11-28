import { NextResponse, type NextRequest } from "next/server";
import { errorStatus, obj, str, arr } from "@/lib/goldfish/http";
import { resolveLines, type LookupLine } from "@/lib/goldfish/scryfall";

const MAX_LINES = 250;

/** Resolves decklist lines to Scryfall cards. POST { lines: [{ name, set?, collectorNumber? }] } */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the deck lines as JSON." }, { status: 400 });
  }
  const raw = arr(obj(body).lines);
  if (!raw.length || raw.length > MAX_LINES) return NextResponse.json({ error: `Send between 1 and ${MAX_LINES} lines.` }, { status: 400 });
  const lines: LookupLine[] = [];
  for (const item of raw.map(obj)) {
    const name = str(item.name)?.trim().slice(0, 141);
    if (!name) return NextResponse.json({ error: "Every line needs a card name." }, { status: 400 });
    const set = str(item.set);
    const collectorNumber = str(item.collectorNumber);
    const valid = set && collectorNumber && /^[a-z0-9]{2,6}$/i.test(set) && /^[\w★-]{1,10}$/.test(collectorNumber);
    lines.push(valid ? { name, set, collectorNumber } : { name });
  }
  try {
    return NextResponse.json(await resolveLines(lines));
  } catch (error) {
    const { status, message } = errorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}
