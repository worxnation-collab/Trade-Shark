import Stripe from "stripe";
import { siteUrl } from "./env";

/**
 * Stripe Payment Links: the direct-buy path. One link per card (or per Lil' Stack), quantity 1, limited to a single
 * completed checkout so a one-of-a-kind card can't sell twice. Nothing here ever runs in the browser.
 */

let client: Stripe | null = null;
export function stripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // STRIPE_API_BASE is for local testing against a fake Stripe server only; leave it unset in production.
  const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
  return (client ??= new Stripe(key, {
    maxNetworkRetries: 1,
    timeout: 15000,
    ...(base ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(":", "") as "http" | "https" } : {}),
  }));
}

/** The subset of the Stripe client we use, so tests can pass a fake. */
export interface PaymentLinkApi {
  paymentLinks: {
    create(params: Stripe.PaymentLinkCreateParams): Promise<{ id: string; url: string }>;
    update(id: string, params: Stripe.PaymentLinkUpdateParams): Promise<{ id: string; active: boolean }>;
  };
}

export interface LinkCard {
  id: string;
  title: string;
  description: string;
  listPrice: number;
}

export interface CreatedLink {
  id: string;
  url: string;
  amount: number;
  withImage: boolean;
}

export const thankYouUrl = (base: string, sku: string) => `${base}/shop/thank-you?card=${encodeURIComponent(sku)}`;
export const cardPageUrl = (base: string, id: string) => `${base}/card/${encodeURIComponent(id)}`;

/** Stripe wants product names ≤ 250 chars and descriptions without our HTML. */
function clean(s: string, max: number) {
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\s+\n/g, "\n").trim().slice(0, max);
}

interface LinkSpec {
  name: string;
  description?: string;
  amount: number; // cents
  image: string | null;
  metadata: Record<string, string>;
  redirect: string;
  inactiveMessage: string;
}

/** Quantity 1, one completed checkout, US shipping. Retries once without the image if Stripe refuses it. */
async function createLink(api: PaymentLinkApi, spec: LinkSpec) {
  const params = (withImage: boolean): Stripe.PaymentLinkCreateParams => ({
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: spec.amount,
          product_data: {
            name: spec.name,
            ...(spec.description ? { description: spec.description } : {}),
            ...(withImage && spec.image ? { images: [spec.image] } : {}),
            metadata: spec.metadata,
          },
        },
      },
    ],
    // One of one: Stripe deactivates the link after the first completed checkout.
    restrictions: { completed_sessions: { limit: 1 } },
    inactive_message: spec.inactiveMessage,
    after_completion: { type: "redirect", redirect: { url: spec.redirect } },
    shipping_address_collection: { allowed_countries: ["US"] },
    metadata: spec.metadata,
  });
  try {
    const link = await api.paymentLinks.create(params(true));
    return { id: link.id, url: link.url, withImage: !!spec.image };
  } catch (e) {
    // Stripe can refuse an image URL it can't use; the link matters more than the picture.
    if (spec.image && /image/i.test(e instanceof Error ? e.message : String(e))) {
      const link = await api.paymentLinks.create(params(false));
      return { id: link.id, url: link.url, withImage: false };
    }
    throw e;
  }
}

export async function createPaymentLink(api: PaymentLinkApi, card: LinkCard, base = siteUrl()): Promise<CreatedLink> {
  if (!base) throw new Error("SITE_URL is not set, so Stripe has nowhere to send buyers after checkout.");
  if (!(card.listPrice > 0)) throw new Error("No list price to charge.");
  const amount = Math.round(card.listPrice * 100);
  if (amount < 50) throw new Error("Stripe's minimum charge is $0.50.");
  const link = await createLink(api, {
    name: clean(card.title, 250) || "Trading card",
    description: card.description ? clean(card.description, 1000) : undefined,
    amount,
    image: base.startsWith("https://") ? `${base}/api/shop/image/${card.id}/front` : null,
    metadata: { card_id: card.id, sku: card.id },
    redirect: thankYouUrl(base, card.id),
    inactiveMessage: "This card has sold. Thanks for stopping by Trade Shark.",
  });
  return { ...link, amount: amount / 100 };
}

export const PACK_PRODUCT_NAME = "Lil\u2019 Stack, Trade Shark";
export const packThankYouUrl = (base: string, id: string) => `${base}/shop/thank-you?stack=${encodeURIComponent(id)}`;

/** One link for a whole Lil' Stack: the description lists every card in it. */
export async function createPackLink(api: PaymentLinkApi, pack: { id: string; price: number; cardNames: string[]; image?: string | null }, base = siteUrl()): Promise<CreatedLink> {
  if (!base) throw new Error("SITE_URL is not set, so Stripe has nowhere to send buyers after checkout.");
  if (!(pack.price > 0)) throw new Error("No pack price to charge.");
  const amount = Math.round(pack.price * 100);
  const link = await createLink(api, {
    name: PACK_PRODUCT_NAME,
    description: clean(`${pack.cardNames.length} cards: ${pack.cardNames.join(", ")}`, 1000),
    amount,
    image: pack.image && base.startsWith("https://") ? pack.image : null,
    metadata: { lil_stack_id: pack.id, sku: `stack-${pack.id}` },
    redirect: packThankYouUrl(base, pack.id),
    inactiveMessage: "This Lil' Stack has sold. Thanks for stopping by Trade Shark.",
  });
  return { ...link, amount: amount / 100 };
}

/** "Expire" = deactivate. Payment Links can't be deleted; inactive links show inactive_message. */
export async function deactivatePaymentLink(api: PaymentLinkApi, id: string) {
  await api.paymentLinks.update(id, { active: false });
}

export function stripeErrorMessage(e: unknown) {
  if (e instanceof Stripe.errors.StripeError) return `Stripe: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
