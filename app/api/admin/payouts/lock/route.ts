import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { releasePack } from "@/lib/game/packs";
import { saveSettings } from "@/lib/settings";

export const runtime = "nodejs";

/** The consignment lock. Locking again takes consignment cards back out of ready stacks (they wait in the hold bin). */
export const POST = guarded(async (req: Request) => {
  const { open } = (await req.json().catch(() => ({}))) as { open?: boolean };
  await saveSettings({ consignOpen: !!open });
  if (!open) for (const p of await db.gamePack.findMany({ where: { status: { in: ["available", "pulling"] }, NOT: { senderIds: { isEmpty: true } } }, select: { id: true } })) await releasePack(p.id, "dissolved", ["available", "pulling"]);
  return NextResponse.json({ ok: true, open: !!open });
});
