import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { consignOpen, ensurePartners, onboardingLink, payPartner, paySender } from "@/lib/partners";
import { isPartner } from "@/lib/partners/split";
import { stripeErrorMessage } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Owner actions, all by hand:
 *   pay      the whole payable balance, one Stripe Connect transfer (senders: only while consignment is open)
 *   retain   a founder's payable kept in the business as reserve money
 *   connect  { accountId } links an acct_…; no body creates an Express account and returns its onboarding link
 */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ kind: string; id: string; action: string }> }) => {
  const { kind, id, action } = await params;
  const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
  if (kind === "founder" && !isPartner(id)) return bad("No such founder.", 404);
  if (kind === "sender") {
    if (!(await consignOpen())) return bad("Consignment is locked. Sender payouts and accounts are off.", 403);
    if (!(await db.sender.findUnique({ where: { id } }))) return bad("No such sender.", 404);
  } else if (kind !== "founder") return bad("Unknown owner.", 404);
  await ensurePartners();

  if (action === "pay") {
    const r = kind === "founder" ? await payPartner(id) : await paySender(id);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "retain" && kind === "founder") {
    const r = await payPartner(id, { retain: true });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "connect") {
    const { accountId } = (await req.json().catch(() => ({}))) as { accountId?: string };
    if (accountId !== undefined) {
      const v = String(accountId).trim();
      if (v && !/^acct_[A-Za-z0-9]+$/.test(v)) return bad("That doesn't look like a Stripe account id (acct_…).");
      if (kind === "founder") await db.partner.update({ where: { id }, data: { stripeAccountId: v || null } });
      else await db.sender.update({ where: { id }, data: { stripeAccountId: v || null } });
      return NextResponse.json({ ok: true });
    }
    try {
      return NextResponse.json({ ok: true, url: await onboardingLink({ kind: kind as "founder" | "sender", id }, new URL(req.url).origin) });
    } catch (e) {
      return bad(stripeErrorMessage(e));
    }
  }
  return bad("Unknown action.", 404);
});
