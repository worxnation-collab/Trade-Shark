import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, isValidSession } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const ok = await isValidSession(req.cookies.get(COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
