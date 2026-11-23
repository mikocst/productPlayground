import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/login" ||
    pathname.startsWith("/p/") ||
    pathname.startsWith("/thumbnails")
  ) return NextResponse.next();

  if (!process.env.PLAYGROUND_PASSWORD) return NextResponse.next();
  if (request.cookies.get("playground_auth")?.value === "granted") return NextResponse.next();

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/:path*"] };
