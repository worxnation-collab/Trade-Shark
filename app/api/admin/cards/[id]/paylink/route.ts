import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { issuePaymentLink } from "@/lib/payLink";
import { getSettings } from "@/lib/settings";
import { FOR_SALE } from "@/lib/types";

export const runtime = "nodejs";

/** Regenerate the pay link: the old one is expired first, then a new one is created at the current list price. */
export const POST = guarded(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const card = await db.card.findUniqueOrThrow({ where: { id } });
  if (!FOR_SALE.includes(card.status as never))
    return NextResponse.json({ ok: false, error: "Only Ready or Listed cards have a pay link. Save the card as Ready first." }, { status: 400 });
  const r = await issuePaymentLink(card, await getSettings());
  if (!r.ok) {
    // The old link is already off; keep the card out of the shop until a new one exists.
    const c = await db.card.update({ where: { id }, data: { status: "NeedsLook" } });
    return NextResponse.json({ ok: false, error: r.error, card: c }, { status: 422 });
  }
  return NextResponse.json({ ok: true, card: r.card });
});
