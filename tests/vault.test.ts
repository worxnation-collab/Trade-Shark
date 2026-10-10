import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "./fakeDb";

const fake = fakeDb();
const CODE = "c0deC0de_-c0deC0de_-c0";
const CODE_HASH = createHash("sha256").update(`roster-roll-code:${CODE}`).digest("hex");
const db = fake.db;
vi.mock("@/lib/db", () => ({ db }));

// Nothing outside the database: no Shippo key (flat-rate quotes), labels and mail are spies.
const buyLabel = vi.fn(async () => ({ labelUrl: "https://shippo.test/label.pdf", trackingCode: "9400", trackingUrl: "https://track.test/9400", cost: 4.1 }));
vi.mock("@/lib/ship/shippo", async (orig) => ({
  ...(await orig<typeof import("@/lib/ship/shippo")>()),
  shippingReady: () => false,
  buyLabel,
  downloadLabel: async () => Buffer.from("%PDF"),
  groundAdvantageRate: async () => ({ shipmentId: "shp_1", rateId: "rate_1", amount: 4.85 }),
  verifyAddress: async () => ({ ok: true, id: "a".repeat(32) }),
}));
vi.mock("@/lib/storage", () => ({ putObject: vi.fn(async () => {}) }));
const sendMail = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/mail", () => ({ sendMail }));
vi.mock("@/lib/game/member", () => ({ perkLeft: async () => false, usePerk: async () => {} }));

process.env.PLAYER_SECRET = "test-secret";
const { caseWhere } = await import("@/lib/caseStock");
const { pullSingle } = await import("@/lib/rosterRoll");
const { cancelVaultItem, creditBalance, sellBack, sellBackQuote } = await import("@/lib/game/vault");
const { buyAndStoreLabel, quoteShipment, shipStored } = await import("@/lib/game/ship");
const { matches } = await import("./fakeDb");

const stockCard = (id: string, listPrice: number) => ({
  id, name: `Card ${id}`, status: "Priced", game: "Pokemon", player: null, setName: "Base", year: "1999", number: "4", variant: null, condition: "LP",
  gamePackId: null, listPrice, suggestedPrice: null, readable: true, frontImage: `scans/${id}.jpg`, frontDisplay: `display/${id}.png`, category: "pokemon", partnerId: "adrian", senderId: null,
});
const buyer = (id: string, card = true) => ({
  id, email: `${id}@test.dev`, name: id, tz: "America/New_York", stripeCustomerId: card ? `cus_${id}` : `guest_${id}`, paymentMethodId: card ? `pm_${id}` : null,
  shipTo: JSON.stringify({ name: id, address: { line1: "1 Reef Rd", city: "Tampa", state: "FL", postal: "33601" } }), addressVerified: false, easypostAddressId: null,
});
const T = (n: string) => fake.t(n);
const vault = () => T("vaultItem");
const card = (id: string) => T("card").find((c) => c.id === id)!;
const inCase = () => T("card").filter((c) => matches(c, caseWhere));
const fakeStripe = () => {
  const charges: { amount: number; description?: string }[] = [];
  return {
    charges,
    api: {
      paymentIntents: { create: async (p: { amount: number; description?: string }) => (charges.push(p), { id: `pi_${charges.length}`, status: "succeeded" }) },
      refunds: { create: async () => ({ id: "re_1", status: "succeeded" }) },
    },
  };
};

async function win(buyerId = "winner") {
  const single = await pullSingle("2026-10-08", "SharkFan", CODE, buyerId);
  expect(single).not.toBeNull();
  return vault().find((v) => v.cardId === single!.id)! as { id: string; cardId: string };
}

beforeEach(() => {
  fake.reset();
  buyLabel.mockClear();
  sendMail.mockClear();
  T("buyer").push(buyer("winner"), buyer("other"));
  T("card").push(stockCard("c1", 6.5));
  T("rosterRollClaim").push({ date: "2026-10-08", handle: "SharkFan", score: 9120, status: "unclaimed", cardId: null, buyerId: null, codeHash: CODE_HASH });
});

describe("prize reservation", () => {
  it("reserves the exact card and writes the vault row", async () => {
    const now = new Date("2026-10-09T14:00:00Z");
    await pullSingle("2026-10-08", "SharkFan", CODE, "winner", now);
    expect(card("c1").status).toBe("Vaulted");
    expect(vault()).toEqual([
      expect.objectContaining({ buyerId: "winner", cardId: "c1", name: "Card c1", image: "display/c1.png", condition: "LP", value: 6.5, status: "in_vault", stockStatus: "Priced", source: "roster-roll", sourceRef: "2026-10-08", wonAt: now, orderId: null }),
    ]);
  });

  it("a reserved card can't be drawn, shown or sold again", async () => {
    await win();
    expect(inCase()).toHaveLength(0); // the case and pack builder both draw from Priced/BulkHold only
    // A second winner the next day finds nothing to give.
    T("rosterRollClaim").push({ date: "2026-10-09", handle: "Reef_99", score: 1, status: "unclaimed", cardId: null, buyerId: null, codeHash: CODE_HASH });
    expect(await pullSingle("2026-10-09", "Reef_99", CODE, "other")).toBeNull();
    expect(vault()).toHaveLength(1);
  });
});

describe("no auto-ship", () => {
  it("winning creates no quote, parcel, charge or label", async () => {
    await win();
    expect(T("shipQuote")).toHaveLength(0);
    expect(T("shipOrder")).toHaveLength(0);
    expect(T("gameCharge")).toHaveLength(0);
    expect(buyLabel).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("a quote alone charges nothing and leaves the single in the vault", async () => {
    const item = await win();
    const q = await quoteShipment(T("buyer")[0] as never, [], null, [item.id]);
    expect(q).toMatchObject({ ok: true, ship: { amount: 5.95, how: "fallback", packs: 0, singles: 1 } });
    expect(T("gameCharge")).toHaveLength(0);
    expect(T("shipOrder")).toHaveLength(0);
    expect(vault()[0].status).toBe("in_vault");
  });
});

describe("ship request", () => {
  it("confirming the quote charges shipping only, then the label marks it shipped", async () => {
    const item = await win();
    const b = T("buyer")[0] as never;
    const q = await quoteShipment(b, [], null, [item.id]);
    const stripe = fakeStripe();
    const r = await shipStored(b, (q as { ship: { quoteId: string } }).ship.quoteId, { api: stripe.api as never });
    expect(r).toMatchObject({ ok: true, shipping: 5.95, packs: 0, singles: 1 });
    expect(stripe.charges).toEqual([expect.objectContaining({ amount: 595, description: "Trade Shark · shipping 1 single" })]);
    expect(vault()[0]).toMatchObject({ status: "ship_requested", orderId: (r as { orderId: string }).orderId });
    expect(buyLabel).not.toHaveBeenCalled(); // flat rate: I buy the label from Orders

    await buyAndStoreLabel((r as { orderId: string }).orderId);
    expect(buyLabel).toHaveBeenCalledOnce();
    expect(vault()[0].status).toBe("shipped");
    expect(card("c1").status).toBe("Vaulted"); // never back in stock
  });

  it("only the owner can ship it", async () => {
    const item = await win();
    expect(await quoteShipment(T("buyer")[1] as never, [], null, [item.id])).toMatchObject({ ok: false });
  });

  it("a declined card puts the single back in the vault", async () => {
    const item = await win();
    const b = T("buyer")[0] as never;
    const q = await quoteShipment(b, [], null, [item.id]);
    const declined = { paymentIntents: { create: async () => ({ id: "pi_x", status: "requires_action" }) }, refunds: { create: async () => ({ id: "", status: null }) } };
    const r = await shipStored(b, (q as { ship: { quoteId: string } }).ship.quoteId, { api: declined as never });
    expect(r).toMatchObject({ ok: false, code: "declined" });
    expect(vault()[0]).toMatchObject({ status: "in_vault", orderId: null });
    expect(T("shipOrder")).toHaveLength(0);
  });

  it("a guest winner with no saved card is asked for one before anything is charged", async () => {
    T("buyer").push(buyer("guest", false));
    const single = await pullSingle("2026-10-08", "SharkFan", CODE, "guest");
    const item = vault().find((v) => v.cardId === single!.id)! as { id: string };
    const g = T("buyer").find((x) => x.id === "guest") as never;
    const q = await quoteShipment(g, [], null, [item.id]);
    expect(await shipStored(g, (q as { ship: { quoteId: string } }).ship.quoteId, { api: fakeStripe().api as never })).toMatchObject({ ok: false, code: "no-card" });
    expect(vault()[0].status).toBe("in_vault");
  });
});

describe("sell-back", () => {
  it("pays the configured share in store credit and restocks the card", async () => {
    const item = await win();
    expect(await sellBackQuote("winner", item.id)).toEqual({ id: item.id, pct: 80, credit: 5.2 });
    expect(await sellBack("winner", item.id)).toEqual({ ok: true, credit: 5.2, balance: 5.2 });
    expect(vault()[0].status).toBe("sold_back");
    expect(card("c1").status).toBe("Priced");
    expect(inCase().map((c) => c.id)).toEqual(["c1"]); // drawable again
    expect(T("creditEntry")).toEqual([expect.objectContaining({ buyerId: "winner", kind: "sell-back", amount: 5.2, ref: `sellback:${item.id}` })]);
    // Twice does nothing.
    expect(await sellBack("winner", item.id)).toMatchObject({ ok: false });
    expect(await creditBalance("winner")).toBe(5.2);
  });

  it("uses the percent from settings", async () => {
    T("setting").push({ key: "settings", value: JSON.stringify({ sellBackPct: 50 }) });
    const item = await win();
    expect(await sellBack("winner", item.id)).toMatchObject({ ok: true, credit: 3.25 });
  });

  it("only the owner, and only while it's in the vault", async () => {
    const item = await win();
    expect(await sellBackQuote("other", item.id)).toBeNull();
    expect(await sellBack("other", item.id)).toMatchObject({ ok: false });
    expect(card("c1").status).toBe("Vaulted");
    const b = T("buyer")[0] as never;
    const q = await quoteShipment(b, [], null, [item.id]);
    await shipStored(b, (q as { ship: { quoteId: string } }).ship.quoteId, { api: fakeStripe().api as never });
    expect(await sellBack("winner", item.id)).toMatchObject({ ok: false }); // already asked to ship
    expect(T("creditEntry")).toHaveLength(0);
  });

  it("I can cancel a prize still in the vault; the card goes back to stock", async () => {
    const item = await win();
    expect(await cancelVaultItem(item.id)).toBe(true);
    expect(vault()[0].status).toBe("cancelled");
    expect(card("c1").status).toBe("Priced");
  });
});
