import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { buildLilStacks, rebuildAllLilStacks } from "@/lib/lilStack";

export const runtime = "nodejs";

/** Rebuild Lil' Stacks (after a reprice). ?batch=<id> for one batch, otherwise every batch. */
export const POST = guarded(async (req: Request) => {
  const batch = new URL(req.url).searchParams.get("batch");
  return NextResponse.json(batch ? await buildLilStacks(batch) : await rebuildAllLilStacks());
});
