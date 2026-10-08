import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { isCategory, productName } from "@/lib/categories";
import { db } from "@/lib/db";
import { listMore } from "@/lib/desk";
import { markPacked, sellOnFacebook, voidFacebookSale } from "@/lib/game/packs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The pack desk's buttons, all by hand:
 *   placed  { ids }       those cards are in their tray slots (step 2)
 *   packed    { packId }    the founder pulled that listed stack (doesn't change whether it's for sale)
 *   list-more { category }  "List next 10": let the engine list up to 10 more packs
 */
export const POST = guarded(async (req: Request) => {
  const b = (await req.json().catch(() => ({}))) as { action?: string; ids?: string[]; category?: string; packId?: string };
  const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });
  if (b.action === "placed") {
    const ids = (b.ids ?? []).map(String).slice(0, 500);
    const n = await db.card.updateMany({ where: { id: { in: ids }, location: { not: null } }, data: { sortedAt: new Date() } });
    return NextResponse.json({ ok: true, placed: n.count });
  }
  if (b.action === "packed") {
    const ok = await markPacked(String(b.packId ?? ""));
    return ok ? NextResponse.json({ ok: true }) : bad("That pack is already packed or no longer listed.");
  }
  if (b.action === "list-more") {
    if (!isCategory(b.category)) return bad("Pick a category.");
    const r = await listMore(b.category);
    return NextResponse.json({ ok: true, ...r });
  }
  if (b.action === "facebook") {
    if (!isCategory(b.category)) return bad("Pick baseball, football or Pokemon.");
    const pack = await sellOnFacebook(b.category);
    if (!pack) return bad(`No ready ${productName(b.category)}s. That category is empty.`);
    return NextResponse.json({ ok: true, packId: pack.id, label: `${productName(b.category)} ${pack.number ?? ""}`.trim() });
  }
  if (b.action === "facebook-void") {
    const ok = await voidFacebookSale(String(b.packId ?? ""));
    return ok ? NextResponse.json({ ok: true }) : bad("That isn't a Facebook sale.");
  }
  return bad("Unknown action.");
});
