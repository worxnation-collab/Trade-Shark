import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Public health check: says whether the database answers and, if not, what kind of failure. No details leak. */
export async function GET() {
  try {
    await db.$queryRaw`select 1`;
    return NextResponse.json({ db: "ok" });
  } catch (e) {
    const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
    const kind = /tenant or user not found/.test(m)
      ? "wrong_pooler_host_or_user"
      : /password authentication failed|authentication/.test(m)
        ? "bad_password"
        : /can't reach|timeout|timed out|econnrefused|enotfound/.test(m)
          ? "unreachable"
          : /environment variable not found/.test(m)
            ? "missing_env"
            : "other";
    return NextResponse.json({ db: "error", kind }, { status: 503 });
  }
}
