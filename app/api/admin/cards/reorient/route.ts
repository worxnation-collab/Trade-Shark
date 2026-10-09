import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { reorientCard } from "@/lib/orient";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Stand up one card that was scanned before auto-rotate existed. Call until `remaining` is 0 (one card per request). */
export const POST = guarded(async () => {
  const where = { rotationNote: "before auto-rotate", readable: true, frontImage: { not: null }, status: { in: ["Inbox", "Identified", "Priced", "BulkHold", "NeedsLook"] } };
  const card = await db.card.findFirst({ where });
  if (card) {
    const r = await reorientCard(card);
    if (r.rotationNote === "before auto-rotate") await db.card.update({ where: { id: card.id }, data: { rotationNote: "checked" } }); // never loop on one card
  }
  return NextResponse.json({ ok: true, did: card?.id ?? null, remaining: await db.card.count({ where }) });
});
