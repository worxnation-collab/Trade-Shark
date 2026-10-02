import { NextResponse } from "next/server";
import { requireSession } from "./session";

export function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** Wrap a route handler with the session check and JSON error reporting. */
export function guarded<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A) => {
    if (!(await requireSession())) return unauthorized();
    try {
      return await fn(...a);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  };
}
