import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { syncPackLink } from "@/lib/lilStack";
import { issuePaymentLink, needsLink } from "@/lib/payLink";
import { getSettings } from "@/lib/settings";
import { shipForStack } from "@/lib/shipping";
import { FOR_SALE } from "@/lib/types";

export const runtime = "nodejs";

const PER_CALL = 4; // Stripe calls per request, to stay well under the function timeout

/**
 * Bring live pay links in line with the current price and shipping rules (after a rate change).
 * The UI calls this until remaining is 0. A card whose new link fails drops to Priced (its old link is
 * already expired), the same as any failed link.
 */
export const POST = guarded(async () => {
  const s = await getSettings();
  const ship = shipForStack(s.buyerShipping);
  const [cards, packs] = await Promise.all([
    db.card.findMany({ where: { status: { in: FOR_SALE }, listPrice: { not: null } } }),
    db.lilStack.findMany({ where: { status: "open" } }),
  ]);
  const staleCards = cards.filter((c) => needsLink(c, s));
  const stalePacks = packs.filter((p) => !p.paymentLinkActive || p.paymentLinkShipping !== ship.amount || p.paymentLinkShipMethod !== ship.method);
  const errors: string[] = [];
  let done = 0;
  for (const c of staleCards.slice(0, PER_CALL)) {
    const r = await issuePaymentLink(c, s);
    if (!r.ok) {
      errors.push(`${c.name ?? c.id}: ${r.error}`);
      await db.card.update({ where: { id: c.id }, data: { status: "Priced" } });
    }
    done++;
  }
  for (const p of stalePacks.slice(0, Math.max(0, PER_CALL - done))) {
    const r = await syncPackLink(p.id, { force: true });
    if (!r?.paymentLinkActive) errors.push(`pack ${p.seq}: ${r?.linkError ?? "no link"}`);
    done++;
  }
  const remaining = staleCards.length + stalePacks.length - done;
  return NextResponse.json({ done, remaining, errors });
});
