import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { markPackSold, syncPackLink } from "@/lib/lilStack";

export const runtime = "nodejs";

/**
 * Pack actions from the desk:
 * - sold: I sold it by hand (optional amount). Marks the pack and its cards Sold and expires the link.
 * - relink: make a fresh Payment Link (e.g. after adding STRIPE_SECRET_KEY).
 */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { action?: string; amount?: number | string };
  await db.lilStack.findUniqueOrThrow({ where: { id } });
  switch (b.action) {
    case "sold": {
      const amount = b.amount === "" || b.amount == null ? null : Number(b.amount);
      const r = await markPackSold(id, { amount: Number.isFinite(amount) ? amount : null, channel: "local", byHand: true });
      return NextResponse.json(r);
    }
    case "relink": {
      const p = await syncPackLink(id, { force: true });
      return NextResponse.json({ ok: !!p?.paymentLinkActive, error: p?.linkError ?? undefined, pack: p });
    }
    default:
      return NextResponse.json({ ok: false, error: "action must be sold or relink" }, { status: 400 });
  }
});
