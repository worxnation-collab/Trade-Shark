import { NextResponse } from "next/server";
import { checkPassword, COOKIE, sessionToken } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const pw = String(form.get("password") ?? "");
  let next = String(form.get("next") ?? "/admin");
  if (!next.startsWith("/") || next.startsWith("//")) next = "/admin";
  if (!(await checkPassword(pw))) {
    return NextResponse.redirect(new URL(`/login?e=1&next=${encodeURIComponent(next)}`, req.url), 303);
  }
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(COOKIE, (await sessionToken())!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
