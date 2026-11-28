import { NextResponse, type NextRequest } from "next/server";
import { importArchidekt, parseDeckUrl } from "@/lib/goldfish/archidekt";
import { errorStatus } from "@/lib/goldfish/http";

/** Imports a deck from a supported site. GET ?url= */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url") ?? "";
  if (!url || url.length > 300) return NextResponse.json({ error: "Paste a deck link." }, { status: 400 });
  const target = parseDeckUrl(url);
  if (!target) return NextResponse.json({ error: "Only Archidekt links import directly. For other sites, export the list as text and paste it." }, { status: 422 });
  if (target.site === "moxfield") {
    return NextResponse.json({ error: "Moxfield doesn't allow imports. Use Export → Plain Text and paste it here." }, { status: 422 });
  }
  try {
    return NextResponse.json(await importArchidekt(target.id));
  } catch (error) {
    const { status, message } = errorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}
