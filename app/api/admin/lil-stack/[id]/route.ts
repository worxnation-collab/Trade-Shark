import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { getFeatured, isFeatured, setFeatured } from "@/lib/featured";
import { markPackSold, syncPackLink } from "@/lib/lilStack";

export const runtime = "nodejs";

/**
 * Pack actions from the desk:
 * - sold: I sold it by hand (optional amount). Marks the pack and its cards Sold and expires the link.
 * - feature / unfeature: pin it to the home hero.
 * - relink: make a fresh Payment Link (e.g. after adding STRIPE_SECRET_KEY).
 */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { action?: string; amount?: number | string };
  const pack = await db.lilStack.findUniqueOrThrow({ where: { id } });
  switch (b.action) {
    case "sold": {
      const amount = b.amount === "" || b.amount == null ? null : Number(b.amount);
      const r = await markPackSold(id, { amount: Number.isFinite(amount) ? amount : null, channel: "local", byHand: true });
      if (isFeatured(await getFeatured(), "stack", id)) await setFeatured(null);
      return NextResponse.json(r);
    }
    case "feature":
      if (pack.status !== "open") return NextResponse.json({ ok: false, error: "Only an open pack can be featured." }, { status: 400 });
      await setFeatured({ kind: "stack", id });
      return NextResponse.json({ ok: true });
    case "unfeature":
      if (isFeatured(await getFeatured(), "stack", id)) await setFeatured(null);
      return NextResponse.json({ ok: true });
    case "relink": {
      const p = await syncPackLink(id, { force: true });
      return NextResponse.json({ ok: !!p?.paymentLinkActive, error: p?.linkError ?? undefined, pack: p });
    }
    default:
      return NextResponse.json({ ok: false, error: "action must be sold, feature, unfeature or relink" }, { status: 400 });
  }
});
