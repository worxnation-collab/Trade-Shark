import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { applySuggestion } from "@/lib/pipeline";
import { DEFAULT_SETTINGS, saveSettings, type Settings } from "@/lib/settings";

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
  return NextResponse.json(s);
});
