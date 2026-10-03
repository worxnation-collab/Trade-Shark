import { describe, expect, it } from "vitest";
import { LIL_STACK_SIZE, LIL_STACK_UNDER, packLabel, planPacks, qualifies } from "@/lib/lilStack";
import { statusAfterPricing } from "@/lib/pricing/engine";
import { DEFAULT_SETTINGS as S } from "@/lib/settings";

const card = (o: Partial<Parameters<typeof qualifies>[0]> = {}) => ({
  id: "c",
  status: "BulkHold",
  listPrice: 0.5,
  readable: true,
  frontImage: "b/f.jpg",
  pile: "none",
  ...o,
});

describe("Lil' Stack", () => {
  it("threshold is under $1.00: $0.99 goes in, $1.00 stays a single", () => {
    expect(LIL_STACK_UNDER).toBe(1);
    expect(qualifies(card({ listPrice: 0.99 }))).toBe(true);
    expect(qualifies(card({ listPrice: 1 }))).toBe(false);
    expect(qualifies(card({ listPrice: null }))).toBe(false);
  });

  it("only packs priced cards with a photo, never owner decisions or rescans", () => {
    expect(qualifies(card({ status: "Priced" }))).toBe(true);
    expect(qualifies(card({ status: "LilStack" }))).toBe(true);
    for (const status of ["Inbox", "Identified", "Ready", "Listed", "Sold", "Archived"]) expect(qualifies(card({ status }))).toBe(false);
    expect(qualifies(card({ readable: false }))).toBe(false);
    expect(qualifies(card({ frontImage: null }))).toBe(false);
    expect(qualifies(card({ pile: "duplicate" }))).toBe(false);
  });

  it("packs hold up to 12, extras make pack 2, 3…", () => {
    const ids = Array.from({ length: 27 }, (_, i) => `c${i}`);
    const packs = planPacks(ids);
    expect(LIL_STACK_SIZE).toBe(12);
    expect(packs.map((p) => p.length)).toEqual([12, 12, 3]);
    expect(new Set(packs.flat()).size).toBe(27); // each card in exactly one pack
    expect(planPacks([])).toEqual([]);
    expect([1, 2, 3].map(packLabel)).toEqual(["Lil' Stack", "Lil' Stack 2", "Lil' Stack 3"]);
  });

  it("a packed card stays packed under $1 and comes out at $1+", () => {
    expect(statusAfterPricing("LilStack", 0.4, true, S)).toBe("LilStack");
    expect(statusAfterPricing("LilStack", 1, true, S)).toBe("BulkHold"); // $1–$2 is still Bulk Hold
    expect(statusAfterPricing("LilStack", 5, true, S)).toBe("Priced");
    // A fresh sub-$1 card waits in Bulk Hold until the packer picks it up.
    expect(statusAfterPricing("Identified", 0.5, true, S)).toBe("BulkHold");
  });
});

describe("Lil' Stack checkout", () => {
  it("price = sum rounded up to the dollar, minimum $3", async () => {
    const { packPrice, packMath } = await import("@/lib/lilStack");
    expect(packPrice([0.5, 0.5, 0.5])).toBe(3); // $1.50 → min $3
    expect(packPrice([0.99, 0.99, 0.99, 0.99])).toBe(4); // $3.96 → $4
    expect(packPrice([0.75, 0.75, 0.75, 0.75])).toBe(3); // exactly $3.00 stays $3
    expect(packPrice(Array(6).fill(0.6))).toBe(4); // $3.60 → $4 (no float creep)
    expect(packPrice(Array(12).fill(0.99))).toBe(12);
    expect(packMath(6, 4)).toBe("6 cards, $4.");
    expect(packMath(1, 3)).toBe("1 card, $3.");
  });

  it("a pack sale splits across its cards and adds up exactly", async () => {
    const { splitSale } = await import("@/lib/lilStack");
    const shares = splitSale(4, [0.6, 0.6, 0.6, 0.6, 0.6, 0.6]);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(4, 10);
    expect(splitSale(3, [0.1, 0.2])).toEqual([1, 2]);
  });

  it("one Payment Link for the whole pack: name, card list, quantity 1, single checkout, stack thank-you", async () => {
    const { createPackLink, PACK_PRODUCT_NAME } = await import("@/lib/stripe");
    const calls: unknown[] = [];
    const api = {
      paymentLinks: {
        create: async (p: unknown) => (calls.push(p), { id: "plink_1", url: "https://buy.stripe.com/x" }),
        update: async () => ({ id: "plink_1", active: false }),
      },
    };
    const link = await createPackLink(api, { id: "pk1", price: 4, cardNames: ["Pikachu", "Eevee"] }, "https://shop.example");
    expect(link).toMatchObject({ id: "plink_1", amount: 4 });
    const p = calls[0] as {
      line_items: { quantity: number; price_data: { unit_amount: number; product_data: { name: string; description: string } } }[];
      restrictions: unknown;
      after_completion: { redirect: { url: string } };
      metadata: Record<string, string>;
    };
    expect(PACK_PRODUCT_NAME).toBe("Lil’ Stack, Trade Shark");
    expect(p.line_items).toHaveLength(1);
    expect(p.line_items[0].quantity).toBe(1);
    expect(p.line_items[0].price_data.unit_amount).toBe(400);
    expect(p.line_items[0].price_data.product_data.name).toBe(PACK_PRODUCT_NAME);
    expect(p.line_items[0].price_data.product_data.description).toBe("2 cards: Pikachu, Eevee");
    expect(p.restrictions).toEqual({ completed_sessions: { limit: 1 } });
    expect(p.after_completion.redirect.url).toBe("https://shop.example/shop/thank-you?stack=pk1");
    expect(p.metadata.lil_stack_id).toBe("pk1");
  });
});

describe("wow score", () => {
  const base = { name: "Snorlax", player: null, rarity: "Common", variant: null, graded: null, year: "2023", title: null };
  const chase = ["Pikachu", "Charizard", "Umbreon"];
  it("scores art, chase, graded 9-10 and newest set; never price", async () => {
    const { wowScore } = await import("@/lib/wow");
    expect(wowScore(base, { chase }).score).toBe(0);
    expect(wowScore({ ...base, rarity: "Special Illustration Rare" }, { chase }).tags).toEqual(["art"]);
    expect(wowScore({ ...base, rarity: "Illustration Rare" }, { chase }).score).toBe(40);
    expect(wowScore({ ...base, variant: "Full Art" }, { chase }).score).toBe(40);
    expect(wowScore({ ...base, variant: "Alt Art" }, { chase }).score).toBe(40);
    expect(wowScore({ ...base, variant: "Gold Refractor /50" }, { chase }).score).toBe(40);
    expect(wowScore({ ...base, variant: "Reverse Holo" }, { chase }).score).toBe(0);
    expect(wowScore({ ...base, name: "Umbreon ex" }, { chase }).score).toBe(25);
    expect(wowScore({ ...base, name: "Dark Charizard" }, { chase }).score).toBe(25);
    expect(wowScore({ ...base, name: "Mew" }, { chase: [...chase, "Mew"] }).score).toBe(25);
    expect(wowScore({ ...base, graded: "PSA 10" }, { chase }).score).toBe(20);
    expect(wowScore({ ...base, graded: "BGS 9.5" }, { chase }).score).toBe(20);
    expect(wowScore({ ...base, graded: "PSA 8" }, { chase }).score).toBe(0);
    expect(wowScore(base, { chase, newestYear: "2023" }).score).toBe(10);
    expect(wowScore(base, { chase, newestYear: "2025" }).score).toBe(0);
    const all = wowScore({ ...base, name: "Pikachu", rarity: "Special Illustration Rare", graded: "PSA 10" }, { chase, newestYear: "2023" });
    expect(all.score).toBe(95);
  });

  it("home ranks the pin first, then wow, then freshness; never price", async () => {
    const { rankHome } = await import("@/lib/home");
    const items = [
      { kind: "card" as const, id: "cheap-wow", wow: 65, fresh: 1, price: 3 },
      { kind: "card" as const, id: "pricey", wow: 0, fresh: 9, price: 900 },
      { kind: "stack" as const, id: "pack", wow: 25, fresh: 0, price: 4 },
      { kind: "card" as const, id: "tie-new", wow: 25, fresh: 5, price: 1 },
    ];
    expect(rankHome(items, null).map((i) => i.id)).toEqual(["cheap-wow", "tie-new", "pack", "pricey"]);
    expect(rankHome(items, { kind: "card", id: "pricey" })[0].id).toBe("pricey");
    expect(rankHome(items, { kind: "stack", id: "pack" })[0].id).toBe("pack");
    // A pin on something no longer live is ignored: the next best takes the hero.
    expect(rankHome(items.filter((i) => i.id !== "cheap-wow"), { kind: "card", id: "cheap-wow" })[0].id).toBe("tie-new");
  });
});
