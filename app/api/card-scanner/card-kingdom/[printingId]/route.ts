import { NextResponse } from "next/server";
import { getCardKingdomPrices } from "@/lib/cards/card-kingdom";
import { errorStatus } from "@/lib/cards/http";
import { ORACLE_ID } from "@/lib/cards/scryfall";

/** Card Kingdom retail prices for one Scryfall printing id. */
export async function GET(_request: Request, { params }: { params: Promise<{ printingId: string }> }) {
  const { printingId } = await params;
  // Scryfall printing ids use the same UUID shape as oracle ids.
  if (!ORACLE_ID.test(printingId)) return NextResponse.json({ error: "That printing id is not valid." }, { status: 400 });
  try {
    return NextResponse.json(await getCardKingdomPrices(printingId.toLowerCase()));
  } catch (error) {
    const { status, message } = errorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}
