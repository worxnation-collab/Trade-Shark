import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.delete(COOKIE);
  return res;
}
