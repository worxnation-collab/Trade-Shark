import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { ensurePartners, onboardingLink } from "@/lib/partners";
import { isPartner } from "@/lib/partners/split";
import { stripeErrorMessage } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Connect a partner to Stripe. `{ accountId: "acct_…" }` links an account they already have;
 * an empty body creates an Express account (once) and returns its onboarding link to send them.
 */
export const POST = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!isPartner(id)) return NextResponse.json({ ok: false, error: "No such partner." }, { status: 404 });
  await ensurePartners();
  const { accountId } = (await req.json().catch(() => ({}))) as { accountId?: string };
  if (accountId !== undefined) {
    const v = String(accountId).trim();
    if (v && !/^acct_[A-Za-z0-9]+$/.test(v)) return NextResponse.json({ ok: false, error: "That doesn't look like a Stripe account id (acct_…)." }, { status: 400 });
    await db.partner.update({ where: { id }, data: { stripeAccountId: v || null } });
    return NextResponse.json({ ok: true });
  }
  try {
    return NextResponse.json({ ok: true, url: await onboardingLink(id, new URL(req.url).origin) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: stripeErrorMessage(e) }, { status: 400 });
  }
});
