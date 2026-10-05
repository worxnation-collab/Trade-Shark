import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { rebuildAllPacks } from "@/lib/lilStack";

export const runtime = "nodejs";

/** Re-sort cards into categories and rebuild every category's 12-card packs (stable: unchanged packs keep their link). */
export const POST = guarded(async () => NextResponse.json(await rebuildAllPacks()));
