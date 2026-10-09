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
    // Prisma error codes (P1000 auth, P1001 unreachable, ...) are safe to show and help diagnose setup.
    const code = (e as { errorCode?: string }).errorCode ?? (m.match(/\bp\d{4}\b/)?.[0]?.toUpperCase() ?? null);
    const tenant = /tenant or user not found/.test(m);
    return NextResponse.json({ db: "error", kind: tenant ? "wrong_pooler_host_or_user" : kind, code }, { status: 503 });
  }
}
