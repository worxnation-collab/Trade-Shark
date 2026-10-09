import { NextResponse } from "next/server";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function play<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A) => {
    try {
      return await fn(...a);
    } catch (e) {
      console.error("play route failed", e);
      return json({ ok: false, error: "Something went wrong. Nothing was charged for a step that didn't finish." }, 500);
    }
  };
}

export const statusFor = (code?: string) => (code === "no-card" ? 402 : code === "no-looks" || code === "busy" || code === "ship-changed" || code === "no-stack" ? 409 : code === "closed" || code === "expired" ? 410 : 400);
