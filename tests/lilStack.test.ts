import { describe, expect, it } from "vitest";
import { categorize, sportOf } from "@/lib/categories";
import { PACK_SIZE, packLabel, planCategory, planPacks, qualifies } from "@/lib/lilStack";
import { statusAfterPricing } from "@/lib/pricing/engine";
import { DEFAULT_SETTINGS as S } from "@/lib/settings";

const card = (o: Partial<Parameters<typeof qualifies>[0]> = {}) => ({
  status: "Priced",
  listPrice: 2,
  readable: true,
  frontImage: "b/f.jpg",
  category: "pokemon",
  ...o,
});
const ids = (n: number, p = "c") => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe("categories", () => {
  it("Pokemon cards go in the Pokemon Pack; Magic and other games never get packed", () => {
    expect(categorize({ game: "Pokemon" })).toBe("pokemon");
    expect(categorize({ game: "Magic" })).toBe(null);
    expect(categorize({ game: "Other" })).toBe(null);
  });

  it("sports split into baseball and football from team or set; basketball stays out", () => {
    expect(categorize({ game: "Sports", team: "New York Yankees" })).toBe("baseball");
    expect(categorize({ game: "Sports", team: "Dodgers" })).toBe("baseball");
    expect(categorize({ game: "Sports", setName: "2023 Bowman Chrome" })).toBe("baseball");
    expect(categorize({ game: "Sports", team: "Kansas City Chiefs" })).toBe("football");
    expect(categorize({ game: "Sports", setName: "Panini Prizm Football" })).toBe("football");
    expect(categorize({ game: "Sports", team: "Los Angeles Lakers" })).toBe(null);
    expect(sportOf({ team: "Lakers" })).toBe("basketball");
    expect(categorize({ game: "Sports", setName: "NBA Hoops" })).toBe(null);
  });

  it("shared city names need the full team: Giants and Cardinals alone stay unsorted", () => {
    expect(categorize({ game: "Sports", team: "San Francisco Giants" })).toBe("baseball");
    expect(categorize({ game: "Sports", team: "New York Giants" })).toBe("football");
    expect(categorize({ game: "Sports", team: "St. Louis Cardinals" })).toBe("baseball");
    expect(categorize({ game: "Sports", team: "Arizona Cardinals" })).toBe("football");
    expect(categorize({ game: "Sports", team: "Giants" })).toBe(null);
    expect(categorize({ game: "Sports" })).toBe(null);
  });
});

describe("packs", () => {
  it("only priced cards of that category with a photo can be packed", () => {
    expect(qualifies(card(), "pokemon")).toBe(true);
    expect(qualifies(card({ listPrice: 0.25 }), "pokemon")).toBe(true); // any price
    expect(qualifies(card({ listPrice: 40 }), "pokemon")).toBe(true);
    expect(qualifies(card({ status: "LilStack" }), "pokemon")).toBe(true);
    expect(qualifies(card({ status: "BulkHold" }), "pokemon")).toBe(true);
    expect(qualifies(card(), "baseball")).toBe(false);
    expect(qualifies(card({ category: null }), "pokemon")).toBe(false);
    expect(qualifies(card({ listPrice: null }), "pokemon")).toBe(false);
    for (const status of ["Inbox", "Identified", "NeedsLook", "Pulled", "Ready", "Listed", "Sold", "Archived"]) expect(qualifies(card({ status }), "pokemon")).toBe(false);
    expect(qualifies(card({ readable: false }), "pokemon")).toBe(false);
    expect(qualifies(card({ frontImage: null }), "pokemon")).toBe(false);
  });

  it("a pack is exactly 12 cards; leftovers wait in stock", () => {
    expect(PACK_SIZE).toBe(12);
    const plan = planCategory([], ids(27));
    expect(plan.created.map((p) => p.length)).toEqual([12, 12]);
    expect(plan.waiting).toEqual(["c24", "c25", "c26"]);
    expect(new Set(plan.created.flat()).size).toBe(24); // each card in one pack only
    expect(planCategory([], ids(11)).created).toEqual([]);
    expect(planPacks([])).toEqual([]);
  });

  it("rebuilds are stable: unchanged packs keep their cards (and link); new stock makes new packs", () => {
    const first = planCategory([], ids(12));
    const pack = { id: "p1", cardIds: first.created[0] };
    const again = planCategory([pack], [...ids(12), ...ids(12, "n")]);
    expect(again.kept).toHaveLength(1);
    expect(again.kept[0].changed).toBe(false);
    expect(again.kept[0].ids).toEqual(pack.cardIds);
    expect(again.created).toEqual([ids(12, "n")]);
    expect(again.waiting).toEqual([]);
  });

  it("a pack that loses a card refills from stock, or dissolves back to stock if it can't reach 12", () => {
    const pack = { id: "p1", cardIds: ids(12) };
    const refill = planCategory([pack], [...ids(12).filter((id) => id !== "c3"), "x"]);
    expect(refill.kept[0].changed).toBe(true);
    expect(refill.kept[0].ids).toHaveLength(12);
    expect(refill.kept[0].ids).toContain("x");
    expect(refill.kept[0].ids).not.toContain("c3");

    const short = planCategory([pack], ids(12).filter((id) => id !== "c3"));
    expect(short.kept).toEqual([]);
    expect(short.dissolved.map((d) => d.pack.id)).toEqual(["p1"]);
    expect(short.waiting).toHaveLength(11);
  });

  it("labels say which product: Pokemon Pack #1", () => {
    expect(packLabel("pokemon", 1)).toBe("Pokemon Pack #1");
    expect(packLabel("baseball", 2)).toBe("Baseball Pack #2");
    expect(packLabel("football", 3)).toBe("Football Pack #3");
  });

  it("a packed card stays packed when repriced (the pack price follows)", () => {
    expect(statusAfterPricing("LilStack", 0.4, true, S)).toBe("LilStack");
    expect(statusAfterPricing("LilStack", 7, true, S)).toBe("LilStack");
    expect(statusAfterPricing("LilStack", null, true, S)).not.toBe("LilStack");
  });
});

describe("pack checkout", () => {
  it("pack value = the exact sum of the cards' existing prices", async () => {
    const { packPrice, packMath } = await import("@/lib/lilStack");
    expect(packPrice([0.5, 0.5, 0.5])).toBe(1.5);
    expect(packPrice(Array(6).fill(0.6))).toBe(3.6); // no float creep
    expect(packPrice([1, 2, 3, null])).toBe(6);
    expect(packPrice(Array(12).fill(0.99))).toBe(11.88);
    expect(packMath(12, 14)).toBe("12 cards, $14.");
    expect(packMath(12, 11.88)).toBe("12 cards, $11.88.");
  });

  it("a pack sale splits across its cards and adds up exactly", async () => {
    const { splitSale } = await import("@/lib/lilStack");
    const shares = splitSale(4, [0.6, 0.6, 0.6, 0.6, 0.6, 0.6]);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(4, 10);
    expect(splitSale(3, [0.1, 0.2])).toEqual([1, 2]);
  });

  it("one Payment Link per pack: product name, card list, quantity 1, single checkout, pack thank-you", async () => {
    const { createPackLink } = await import("@/lib/stripe");
    const calls: unknown[] = [];
    const api = {
      paymentLinks: {
        create: async (p: unknown) => (calls.push(p), { id: "plink_1", url: "https://buy.stripe.com/x" }),
        update: async () => ({ id: "plink_1", active: false }),
      },
    };
    const link = await createPackLink(api, { id: "pk1", price: 14.5, cardNames: ["Pikachu", "Eevee"], name: "Pokemon Pack, Trade Shark" }, "https://shop.example");
    expect(link).toMatchObject({ id: "plink_1", amount: 14.5 });
    const p = calls[0] as {
      line_items: { quantity: number; price_data: { unit_amount: number; product_data: { name: string; description: string } } }[];
      restrictions: unknown;
      after_completion: { redirect: { url: string } };
      metadata: Record<string, string>;
    };
    expect(p.line_items).toHaveLength(1);
    expect(p.line_items[0].quantity).toBe(1);
    expect(p.line_items[0].price_data.unit_amount).toBe(1450);
    expect(p.line_items[0].price_data.product_data.name).toBe("Pokemon Pack, Trade Shark");
    expect(p.line_items[0].price_data.product_data.description).toBe("2 cards: Pikachu, Eevee");
    expect(p.restrictions).toEqual({ completed_sessions: { limit: 1 } });
    expect(p.after_completion.redirect.url).toBe("https://shop.example/shop/thank-you?stack=pk1");
    expect(p.metadata.lil_stack_id).toBe("pk1");
  });
});
