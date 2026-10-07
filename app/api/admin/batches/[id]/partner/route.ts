import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { CATEGORY_KEYS } from "@/lib/categories";
import { db } from "@/lib/db";
import { buildGamePacks } from "@/lib/game/packs";
import { consignOpen } from "@/lib/partners";
import { parseOwner } from "@/lib/partners/split";

export const runtime = "nodejs";

/** Tag a whole batch to an owner: the batch and every card in it that has no owner yet (sold cards never change). */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { owner } = (await req.json().catch(() => ({}))) as { owner?: string };
  const o = parseOwner(owner);
  if (!o) return NextResponse.json({ error: "Pick a founder or a sender." }, { status: 400 });
  if (o.senderId && (!(await consignOpen()) || !(await db.sender.findUnique({ where: { id: o.senderId } }))))
    return NextResponse.json({ error: "Consignment is locked." }, { status: 403 });
  await db.batch.update({ where: { id }, data: { partnerId: o.partnerId, senderId: o.senderId } });
  const n = await db.card.updateMany({ where: { batchId: id, partnerId: null, senderId: null, status: { not: "Sold" } }, data: { partnerId: o.partnerId, senderId: o.senderId } });
  // Newly tagged cards can fill bins now.
  for (const c of CATEGORY_KEYS) await buildGamePacks(c).catch((e) => console.error("pack build failed", e));
  return NextResponse.json({ ok: true, tagged: n.count });
});
