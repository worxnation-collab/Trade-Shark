import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { CATEGORY_KEYS } from "@/lib/categories";
import { db } from "@/lib/db";
import { buildGamePacks } from "@/lib/game/packs";
import { isPartner } from "@/lib/partners/split";

export const runtime = "nodejs";

/** Tag a whole batch to a partner: the batch and every card in it that has no partner yet (sold cards never change). */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { partnerId } = (await req.json().catch(() => ({}))) as { partnerId?: string };
  if (!isPartner(partnerId)) return NextResponse.json({ error: "Pick Matthew, Adrian or Mike." }, { status: 400 });
  await db.batch.update({ where: { id }, data: { partnerId } });
  const n = await db.card.updateMany({ where: { batchId: id, partnerId: null, status: { not: "Sold" } }, data: { partnerId } });
  // Newly tagged cards can fill bins now.
  for (const c of CATEGORY_KEYS) await buildGamePacks(c).catch((e) => console.error("pack build failed", e));
  return NextResponse.json({ ok: true, tagged: n.count });
});
