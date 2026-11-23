import { NextResponse, type NextRequest } from "next/server";
import { getCombos, MAX_COMBO_PAGE } from "@/lib/cards/commander-spellbook";
import { errorStatus } from "@/lib/cards/http";
import { getPrintings, ORACLE_ID } from "@/lib/cards/scryfall";

/** Commander Spellbook combos for an oracle card: ?oracleId=&offset=&limit= */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const oracleId = params.get("oracleId") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const limit = Number(params.get("limit") ?? 3);
  if (!ORACLE_ID.test(oracleId)) return NextResponse.json({ error: "That card id is not valid." }, { status: 400 });
  if (!Number.isFinite(offset) || offset < 0 || offset > 5000 || !Number.isFinite(limit) || limit < 1 || limit > MAX_COMBO_PAGE) {
    return NextResponse.json({ error: "Invalid page request." }, { status: 400 });
  }

  try {
    // The card name is resolved server-side (cached) so clients cannot send arbitrary upstream queries.
    const { card } = await getPrintings(oracleId);
    return NextResponse.json(await getCombos(oracleId, card.name, offset, limit));
  } catch (error) {
    const { status, message } = errorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}
