import { NextResponse, type NextRequest } from "next/server";
import { arr, errorStatus, obj } from "@/lib/goldfish/http";
import { findCombos } from "@/lib/goldfish/spellbook";

const MAX_CARDS = 150;
const names = (value: unknown) => arr(value).filter((n): n is string => typeof n === "string" && n.trim().length > 0 && n.length <= 141).map((n) => n.trim());

/** Commander Spellbook combos fully in the deck. POST { commanders: string[], main: string[] } */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the deck as JSON." }, { status: 400 });
  }
  const commanders = names(obj(body).commanders).slice(0, 2);
  const main = [...new Set(names(obj(body).main))];
  if (!main.length || main.length > MAX_CARDS) return NextResponse.json({ error: `Send between 1 and ${MAX_CARDS} card names.` }, { status: 400 });
  try {
    return NextResponse.json(await findCombos(commanders, main));
  } catch (error) {
    const { status, message } = errorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}
