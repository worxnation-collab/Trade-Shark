import type { Card } from "@prisma/client";
import { db } from "./db";
import { renderDescription, renderTitle } from "./listing/templates";
import type { Settings } from "./settings";
import { createPaymentLink, deactivatePaymentLink, stripe, stripeErrorMessage, type PaymentLinkApi } from "./stripe";

export type LinkResult = { ok: true; card: Card } | { ok: false; card: Card; error: string };

function api(): PaymentLinkApi {
  const s = stripe();
  if (!s) throw new Error("STRIPE_SECRET_KEY is not set, so no pay link can be created. Add it in Netlify and redeploy.");
  return s as unknown as PaymentLinkApi;
}

/** An active link whose baked-in price no longer matches the list price must be replaced. */
export function linkIsStale(c: Pick<Card, "paymentLinkActive" | "paymentLinkAmount" | "listPrice">) {
  return !!c.paymentLinkActive && c.listPrice != null && Math.round((c.paymentLinkAmount ?? 0) * 100) !== Math.round(c.listPrice * 100);
}

export function needsLink(c: Pick<Card, "paymentLinkActive" | "paymentLinkAmount" | "listPrice">) {
  return !c.paymentLinkActive || linkIsStale(c);
}

/**
 * Create (or regenerate) the card's Payment Link. The old link is expired first so two prices
 * can never be live at once. Title/description are frozen onto the card so the listing and the
 * checkout page say the same thing.
 */
export async function issuePaymentLink(card: Card, s: Settings, apiOverride?: PaymentLinkApi): Promise<LinkResult> {
  try {
    const client = apiOverride ?? api();
    if (card.paymentLinkId && card.paymentLinkActive) {
      await deactivatePaymentLink(client, card.paymentLinkId);
      card = await db.card.update({ where: { id: card.id }, data: { paymentLinkActive: false } });
    }
    // Remember every link this card ever had: a checkout opened on an old link can still complete.
    const history = [...new Set([...card.paymentLinkHistory.split(",").filter(Boolean), ...(card.paymentLinkId ? [card.paymentLinkId] : [])])].join(",");
    const title = card.title || renderTitle(card, s);
    const description = card.description || renderDescription(card, s);
    const link = await createPaymentLink(client, { id: card.id, title, description, listPrice: card.listPrice ?? 0 });
    const updated = await db.card.update({
      where: { id: card.id },
      data: {
        title,
        description,
        paymentLinkId: link.id,
        paymentLinkUrl: link.url,
        paymentLinkCreatedAt: new Date(),
        paymentLinkAmount: link.amount,
        paymentLinkActive: true,
        paymentLinkHistory: history,
      },
    });
    return { ok: true, card: updated };
  } catch (e) {
    return { ok: false, card, error: stripeErrorMessage(e) };
  }
}

/** Turn the link off when a card leaves for-sale status (sold, archived, pulled back). */
export async function retirePaymentLink(card: Card, apiOverride?: PaymentLinkApi): Promise<{ card: Card; error?: string }> {
  if (!card.paymentLinkId || !card.paymentLinkActive) return { card };
  try {
    await deactivatePaymentLink(apiOverride ?? api(), card.paymentLinkId);
  } catch (e) {
    // Stripe already deactivates after the one allowed sale; a failure here is logged, not fatal.
    console.error("deactivate payment link failed", e);
    return { card: await db.card.update({ where: { id: card.id }, data: { paymentLinkActive: false } }), error: stripeErrorMessage(e) };
  }
  return { card: await db.card.update({ where: { id: card.id }, data: { paymentLinkActive: false } }) };
}
