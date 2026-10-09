import { NextResponse } from "next/server";
import { checkPassword, COOKIE, doorSlug, isDoor, sessionToken } from "@/lib/auth";

/** The founder door's form. Only accepted from the door; a wrong password goes back to the door with no message. */
export async function POST(req: Request) {
  const form = await req.formData();
  if (!isDoor(String(form.get("door") ?? ""))) return new NextResponse(null, { status: 404 });
  const pw = String(form.get("password") ?? "");
  if (!(await checkPassword(pw))) {
    await new Promise((r) => setTimeout(r, 1200)); // slow down guessing
    return NextResponse.redirect(new URL(`/${doorSlug()}`, req.url), 303);
  }
  const res = NextResponse.redirect(new URL("/admin/lil-stack", req.url), 303);
  res.cookies.set(COOKIE, (await sessionToken())!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
