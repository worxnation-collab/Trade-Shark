import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { priceCard } from "@/lib/pipeline";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

/** Force-refresh every price source for one card (ignores the stale window). */
export const POST = guarded(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const card = await priceCard(await db.card.findUniqueOrThrow({ where: { id } }), await getSettings());
  return NextResponse.json({ ok: true, listPrice: card.listPrice, status: card.status });
});
