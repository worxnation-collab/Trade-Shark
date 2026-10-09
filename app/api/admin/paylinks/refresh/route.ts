import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";

export const runtime = "nodejs";

/** Payment Links are retired (the reveal game charges saved cards), so there's nothing to refresh. */
export const POST = guarded(async () => NextResponse.json({ done: 0, remaining: 0, errors: [] }));
