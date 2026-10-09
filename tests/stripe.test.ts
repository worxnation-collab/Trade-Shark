/* eslint-disable @typescript-eslint/no-explicit-any */
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { createPaymentLink, type PaymentLinkApi } from "@/lib/stripe";
import { linkIsStale, needsLink } from "@/lib/payLink";

function fakeApi(opts: { failImagesOnce?: boolean } = {}) {
  const calls: any[] = [];
  let n = 0;
  let failed = false;
  const api: PaymentLinkApi = {
    paymentLinks: {
      async create(params) {
        calls.push(params);
        const hasImg = !!(params.line_items?.[0] as any)?.price_data?.product_data?.images;
        if (opts.failImagesOnce && hasImg && !failed) {
          failed = true;
          throw new Error("Invalid URL: image could not be fetched");
        }
        n++;
        return { id: `plink_${n}`, url: `https://buy.stripe.com/test_${n}` };
      },
      async update(id) {
        return { id, active: false };
      },
    },
  };
  return { api, calls };
}

const card = { id: "card123", title: "1999 Base Charizard #4/102 Holo LP", description: "Charizard — Base<br>Condition: Lightly Played", listPrice: 802.85 };

describe("Stripe payment link params", () => {
  it("one card, quantity 1, USD cents, title/description, image, thank-you redirect, single sale", async () => {
    const { api, calls } = fakeApi();
    const link = await createPaymentLink(api, card, "https://trade-shark.netlify.app");
    expect(link).toMatchObject({ id: "plink_1", url: "https://buy.stripe.com/test_1", amount: 802.85, withImage: true });
    const p = calls[0];
    const li = p.line_items[0];
    expect(li.quantity).toBe(1);
    expect(li.price_data).toMatchObject({ currency: "usd", unit_amount: 80285 });
    expect(li.price_data.product_data.name).toBe(card.title);
    expect(li.price_data.product_data.description).toBe("Charizard — Base\nCondition: Lightly Played");
    expect(li.price_data.product_data.images).toEqual(["https://trade-shark.netlify.app/api/shop/image/card123/front"]);
    expect(p.after_completion).toEqual({ type: "redirect", redirect: { url: "https://trade-shark.netlify.app/shop/thank-you?card=card123" } });
    expect(p.restrictions).toEqual({ completed_sessions: { limit: 1 } });
    expect(p.metadata).toMatchObject({ card_id: "card123" });
  });

  it("retries without the image if Stripe rejects it", async () => {
    const { api, calls } = fakeApi({ failImagesOnce: true });
    const link = await createPaymentLink(api, card, "https://trade-shark.netlify.app");
    expect(link.withImage).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[1].line_items[0].price_data.product_data.images).toBeUndefined();
  });

  it("refuses without SITE_URL or under Stripe's minimum, and skips images on http", async () => {
    const { api, calls } = fakeApi();
    await expect(createPaymentLink(api, card, "")).rejects.toThrow(/SITE_URL/);
    await expect(createPaymentLink(api, { ...card, listPrice: 0.3 }, "https://x.test")).rejects.toThrow(/0\.50/);
    await createPaymentLink(api, card, "http://localhost:3000");
    expect(calls.at(-1).line_items[0].price_data.product_data.images).toBeUndefined();
  });

  it("knows when a link is stale", () => {
    expect(needsLink({ paymentLinkActive: false, paymentLinkAmount: null, listPrice: 5 })).toBe(true);
    expect(linkIsStale({ paymentLinkActive: true, paymentLinkAmount: 5, listPrice: 5 })).toBe(false);
    expect(linkIsStale({ paymentLinkActive: true, paymentLinkAmount: 5, listPrice: 6.5 })).toBe(true);
  });
});

describe("webhook signatures", () => {
  it("accepts Stripe-signed payloads and rejects tampering", () => {
    const s = new Stripe("sk_test_unused");
    const secret = "whsec_test_123";
    const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
    const header = s.webhooks.generateTestHeaderString({ payload, secret });
    expect(s.webhooks.constructEvent(payload, header, secret).id).toBe("evt_1");
    expect(() => s.webhooks.constructEvent(payload.replace("cs_1", "cs_2"), header, secret)).toThrow();
  });
});
