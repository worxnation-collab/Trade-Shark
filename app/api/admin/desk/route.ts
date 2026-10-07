import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { isCategory } from "@/lib/categories";
import { db } from "@/lib/db";
import { BUILD_BATCH, buildGamePacks, confirmPack, previewBuild, releasePack } from "@/lib/game/packs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The pack desk's buttons, all by hand:
 *   placed  { ids }       those cards are in their tray slots (step 2)
 *   build   { category }  build the next 10 packs, only when 10 legal packs can be built (step 3)
 *   confirm { packId }    all 12 pulled: the pack goes on sale (step 5)
 *   cancel  { packId }    take a pack that's still being pulled apart (cards stay in their slots)
 */
export const POST = guarded(async (req: Request) => {
  const b = (await req.json().catch(() => ({}))) as { action?: string; ids?: string[]; category?: string; packId?: string };
  const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });
  if (b.action === "placed") {
    const ids = (b.ids ?? []).map(String).slice(0, 500);
    const n = await db.card.updateMany({ where: { id: { in: ids }, location: { not: null } }, data: { sortedAt: new Date() } });
    return NextResponse.json({ ok: true, placed: n.count });
  }
  if (b.action === "build") {
    if (!isCategory(b.category)) return bad("Pick a category.");
    const preview = await previewBuild(b.category, BUILD_BATCH);
    if (preview.packs.length < BUILD_BATCH) return bad(`Only ${preview.packs.length} legal packs right now.`);
    return NextResponse.json({ ok: true, ...(await buildGamePacks(b.category, { count: BUILD_BATCH })) });
  }
  if (b.action === "confirm") {
    const ok = await confirmPack(String(b.packId ?? ""));
    return ok ? NextResponse.json({ ok: true }) : bad("That pack isn't waiting to be pulled.");
  }
  if (b.action === "cancel") {
    const ok = await releasePack(String(b.packId ?? ""), "dissolved", ["pulling"]);
    return ok ? NextResponse.json({ ok: true }) : bad("That pack isn't waiting to be pulled.");
  }
  return bad("Unknown action.");
});
