import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { flagNameDuplicate, identifyCard, priceCard } from "@/lib/pipeline";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

/** Clear my confirmation and run every identity source again. */
export const POST = guarded(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const s = await getSettings();
  let card = await db.card.update({ where: { id }, data: { confirmedAt: null, identSource: null } });
  card = await identifyCard(card, s);
  card = await flagNameDuplicate(card);
  card = await priceCard(card, s);
  return NextResponse.json({ ok: true, status: card.status });
});
