import { describe, expect, it } from "vitest";
import { linkIsStale, needsLink } from "@/lib/payLink";
import { DEFAULT_SETTINGS as S } from "@/lib/settings";
import { checkoutLine, shipForCard, shipForStack } from "@/lib/shipping";
import { createPackLink, createPaymentLink } from "@/lib/stripe";

const R = S.buyerShipping;

describe("buyer shipping", () => {
  it("defaults: envelope $1.50, mailer $6, free at $35", () => {
    expect(R).toEqual({ pwe: 1.5, bubble: 6, freeAt: 35 });
  });

  it("a raw single under $20 goes in a stamped envelope unless I override it", () => {
    expect(shipForCard({ price: 5 }, R)).toMatchObject({ method: "pwe", label: "Stamped envelope", amount: 1.5, tracked: false, free: false });
    expect(shipForCard({ price: 19.99 }, R).method).toBe("pwe");
    expect(shipForCard({ price: 5, profile: "bubble" }, R)).toMatchObject({ method: "bubble", amount: 6 });
    expect(shipForCard({ price: 5, profile: "slab" }, R).method).toBe("bubble");
  });

  it("graded or $20+ ships tracked; $35+ ships free", () => {
    expect(shipForCard({ price: 8, graded: "PSA 9" }, R)).toMatchObject({ method: "bubble", label: "Tracked bubble mailer", amount: 6, tracked: true });
    expect(shipForCard({ price: 20 }, R)).toMatchObject({ method: "bubble", amount: 6 });
    expect(shipForCard({ price: 34.99 }, R)).toMatchObject({ amount: 6, free: false });
    expect(shipForCard({ price: 35 }, R)).toMatchObject({ method: "bubble", amount: 0, free: true });
    // No $5 unlock: cheap cards always pay their shipping.
    expect(shipForCard({ price: 5 }, R).amount).toBeGreaterThan(0);
    // Editable cutoff
    expect(shipForCard({ price: 25 }, { ...R, freeAt: 25 }).free).toBe(true);
  });

  it("a Lil' Stack always uses a bubble mailer and never ships free", () => {
    expect(shipForStack(R)).toMatchObject({ method: "bubble", amount: 6, free: false });
    expect(shipForStack({ ...R, freeAt: 0 }).amount).toBe(6);
  });

  it("shows cards, shipping and total", () => {
    expect(checkoutLine(4, { amount: 6, free: false }, "Cards")).toBe("Cards $4 · Shipping $6 · Total $10");
    expect(checkoutLine(5, { amount: 1.5, free: false }, "Card")).toBe("Card $5 · Shipping $1.50 · Total $6.50");
    expect(checkoutLine(40, { amount: 0, free: true }, "Card")).toBe("Card $40 · Shipping free · Total $40");
  });

  it("a live link goes stale when its shipping no longer matches the rules", () => {
    const live = { paymentLinkActive: true, paymentLinkAmount: 5, listPrice: 5, graded: null, shippingProfile: "standard", paymentLinkShipping: 1.5, paymentLinkShipMethod: "pwe" };
    expect(linkIsStale(live, S)).toBe(false);
    expect(linkIsStale({ ...live, shippingProfile: "bubble" }, S)).toBe(true); // I switched it to a mailer
    expect(linkIsStale(live, { buyerShipping: { ...R, pwe: 2 } })).toBe(true); // rate changed
    expect(needsLink({ ...live, paymentLinkShipMethod: null, paymentLinkShipping: null }, S)).toBe(true); // made before shipping existed
  });
});

describe("shipping line on the Stripe link", () => {
  const capture = () => {
    const calls: Record<string, unknown>[] = [];
    return {
      calls,
      api: {
        paymentLinks: {
          create: async (p: unknown) => (calls.push(p as Record<string, unknown>), { id: "plink_1", url: "https://buy.stripe.com/x" }),
          update: async () => ({ id: "plink_1", active: false }),
        },
      },
    };
  };
  type Line = { quantity: number; price_data: { unit_amount: number; product_data: { name: string; description?: string } } };

  it("adds its own labeled line on top of the card price", async () => {
    const { calls, api } = capture();
    const link = await createPaymentLink(api, { id: "c1", title: "Pikachu", description: "", listPrice: 5 }, "https://x.test", { label: "Stamped envelope", amount: 1.5, method: "pwe" });
    const lines = calls[0].line_items as Line[];
    expect(link.amount).toBe(5); // merchandise only; shipping isn't baked in
    expect(lines.map((l) => [l.price_data.product_data.name, l.price_data.unit_amount, l.quantity])).toEqual([
      ["Pikachu", 500, 1],
      ["Stamped envelope", 150, 1],
    ]);
    expect(calls[0].metadata).toMatchObject({ ship_method: "pwe", ship_amount: "1.50" });
  });

  it("free shipping: no shipping line, noted on the product", async () => {
    const { calls, api } = capture();
    await createPaymentLink(api, { id: "c2", title: "Charizard", description: "", listPrice: 40 }, "https://x.test", { label: "Tracked bubble mailer", amount: 0, method: "bubble" });
    const lines = calls[0].line_items as Line[];
    expect(lines).toHaveLength(1);
    expect(lines[0].price_data.product_data.description).toMatch(/free tracked bubble mailer/i);
  });

  it("a pack: pack price stays the sum, mailer is its own line", async () => {
    const { calls, api } = capture();
    await createPackLink(api, { id: "p1", price: 4, cardNames: ["A", "B"] }, "https://x.test", { label: "Tracked bubble mailer", amount: 6, method: "bubble" });
    const lines = calls[0].line_items as Line[];
    expect(lines.map((l) => l.price_data.unit_amount)).toEqual([400, 600]);
    expect(lines[1].price_data.product_data.name).toBe("Tracked bubble mailer");
  });
});
