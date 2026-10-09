import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, isValidSession } from "@/lib/auth";

/** Signed out, the desk doesn't exist: pages 404 (no login redirect to point anyone at the door), APIs 401. */
export async function middleware(req: NextRequest) {
  const ok = await isValidSession(req.cookies.get(COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.rewrite(new URL("/404", req.url), { status: 404 });
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
