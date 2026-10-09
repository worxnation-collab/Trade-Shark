import type Stripe from "stripe";
import { db } from "../db";
import { stripe, stripeErrorMessage } from "../stripe";

/** The bits of Stripe the game uses, so tests can pass a fake. */
export interface ChargeApi {
  paymentIntents: { create(p: Stripe.PaymentIntentCreateParams, o?: Stripe.RequestOptions): Promise<{ id: string; status: string }> };
  refunds: { create(p: Stripe.RefundCreateParams, o?: Stripe.RequestOptions): Promise<{ id: string; status: string | null }> };
}

export const chargeApi = () => stripe() as unknown as ChargeApi | null;

export type ChargeKind = "keep" | "blind" | "ship";

/**
 * Charge the player's saved card right now. Every attempt is written to GameCharge. The idempotency key is the
 * cycle (or, for shipping, the parcel: `ref`) + kind + attempt number: a retried request can't charge twice, and a retry after a decline gets a fresh try
 * (double taps are stopped earlier, by the cycle's status claim).
 */
export async function chargeSaved(
  buyer: { id: string; stripeCustomerId: string; paymentMethodId: string | null },
  amount: number,
  kind: ChargeKind,
  cycleId: string | null,
  description: string,
  api: ChargeApi | null = chargeApi(),
  ref: string | null = null,
): Promise<{ ok: true; paymentIntentId: string } | { ok: false; error: string }> {
  const key = ref ?? cycleId ?? "";
  const fail = async (error: string, paymentIntentId?: string) => {
    await db.gameCharge.create({ data: { buyerId: buyer.id, cycleId, ref, kind, amount, status: "failed", error: error.slice(0, 500), paymentIntentId } });
    return { ok: false as const, error };
  };
  if (!api) return fail("Payments aren't set up yet (STRIPE_SECRET_KEY).");
  if (!buyer.paymentMethodId) return fail("Save a card first.");
  const attempt = await db.gameCharge.count({ where: ref ? { ref, kind } : { cycleId, kind } });
  try {
    const pi = await api.paymentIntents.create(
      {
        amount: Math.round(amount * 100),
        currency: "usd",
        customer: buyer.stripeCustomerId,
        payment_method: buyer.paymentMethodId,
        off_session: true,
        confirm: true,
        description,
        metadata: { trade_shark: "game", kind, ...(cycleId ? { cycle_id: cycleId } : {}), ...(ref ? { ref } : {}), buyer_id: buyer.id },
      },
      { idempotencyKey: `ts-${key}-${kind}-${attempt}` },
    );
    if (pi.status !== "succeeded") return fail(`Your bank wants to confirm this payment (${pi.status}). Try a different card.`, pi.id);
    await db.gameCharge.create({ data: { buyerId: buyer.id, cycleId, ref, kind, amount, status: "succeeded", paymentIntentId: pi.id } });
    return { ok: true, paymentIntentId: pi.id };
  } catch (e) {
    const err = e as { code?: string; payment_intent?: { id?: string } };
    const msg = err.code === "authentication_required" ? "Your bank wants to confirm this payment. Try a different card." : stripeErrorMessage(e);
    return fail(msg, err.payment_intent?.id);
  }
}

/** Give a charge back (only when we took money and then couldn't hand over a pack). */
export async function refund(buyerId: string, cycleId: string | null, paymentIntentId: string, amount: number, api: ChargeApi | null = chargeApi()) {
  try {
    const r = await api!.refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey: `ts-refund-${paymentIntentId}` });
    await db.gameCharge.create({ data: { buyerId, cycleId, kind: "refund", amount: -amount, status: "succeeded", paymentIntentId } });
    return r;
  } catch (e) {
    await db.gameCharge.create({ data: { buyerId, cycleId, kind: "refund", amount: -amount, status: "failed", paymentIntentId, error: stripeErrorMessage(e).slice(0, 500) } });
    return null;
  }
}
