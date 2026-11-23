import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    const expected = process.env.PLAYGROUND_PASSWORD;
    if (!expected || password !== expected) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set("playground_auth", "granted", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("playground_auth");
  return response;
}
