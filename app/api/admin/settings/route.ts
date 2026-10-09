import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { applySuggestion } from "@/lib/pipeline";
import { DEFAULT_SETTINGS, saveSettings, type Settings } from "@/lib/settings";
import { recomputeBatchWow } from "@/lib/wow";

export const runtime = "nodejs";

export const POST = guarded(async (req: Request) => {
  const body = (await req.json()) as Partial<Settings> & { reset?: boolean; recompute?: boolean };
  const { reset, recompute, ...rest } = body;
  const s = await saveSettings(reset ? DEFAULT_SETTINGS : rest);
  if (recompute) {
    // Re-apply the rule to stored quotes (no network) for cards still in the pricing stages.
    const cards = await db.card.findMany({ where: { status: { in: ["Inbox", "Identified", "Priced", "BulkHold", "Ready"] } }, select: { id: true } });
    for (const c of cards) await applySuggestion(c.id, s);
  }
  // The chase list feeds the wow score of every card, live ones included.
  for (const b of await db.batch.findMany({ select: { id: true } })) await recomputeBatchWow(b.id, s);
  return NextResponse.json(s);
});
