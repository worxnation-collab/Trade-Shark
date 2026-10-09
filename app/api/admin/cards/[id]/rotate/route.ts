import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { turnCard, type Deg } from "@/lib/orient";

export const runtime = "nodejs";

/** One-tap rotate: ?deg=90|180|270 (clockwise) turns front and back in place; ?deg=0 confirms it's already upright. */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const deg = Number(new URL(req.url).searchParams.get("deg"));
  if (![0, 90, 180, 270].includes(deg)) return NextResponse.json({ ok: false, error: "deg must be 0, 90, 180 or 270" }, { status: 400 });
  const card = await turnCard(await db.card.findUniqueOrThrow({ where: { id } }), deg as Deg);
  return NextResponse.json({ ok: true, card });
});
