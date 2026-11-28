import { NextResponse } from "next/server";
import { errorStatus } from "@/lib/cards/http";
import { getPrintings, ORACLE_ID } from "@/lib/cards/scryfall";

/** Card identity plus every printing for one Scryfall oracle id. */
export async function GET(_request: Request, { params }: { params: Promise<{ oracleId: string }> }) {
  const { oracleId } = await params;
  if (!ORACLE_ID.test(oracleId)) return NextResponse.json({ error: "That card id is not valid." }, { status: 400 });
  try {
    return NextResponse.json(await getPrintings(oracleId));
  } catch (error) {
    const { status, message } = errorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}
