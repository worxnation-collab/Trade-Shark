import { describe, expect, it } from "vitest";
import { DISCLAIMERS } from "@/lib/disclaimers";
import { friendly, renderDescription } from "@/lib/listing/templates";
import { decide, isIdentified } from "@/lib/publish";
import { DEFAULT_SETTINGS as S } from "@/lib/settings";

const c = (o: Partial<Parameters<typeof decide>[0]> = {}) => ({
  name: "Pikachu",
  player: null,
  identSource: "vision:anthropic",
  readable: true,
  frontImage: "b/f.jpg",
  listPrice: 3,
  ...o,
});

describe("auto-publish on upload", () => {
  it("$5 and under goes live, over $5 needs a look (dollars, not confidence)", () => {
    expect(decide(c({ listPrice: 1 }))).toBe("publish");
    expect(decide(c({ listPrice: 5 }))).toBe("publish");
    expect(decide(c({ listPrice: 6 }))).toBe("review");
    expect(decide(c({ listPrice: 250 }))).toBe("review");
  });

  it("under $1 bundles into a Lil' Stack", () => {
    expect(decide(c({ listPrice: 0.42 }))).toBe("stack");
  });

  it("never invents a name: no name or only a filename guess is held", () => {
    expect(decide(c({ name: null }))).toBe("hold");
    expect(decide(c({ name: "  " }))).toBe("hold");
    expect(decide(c({ identSource: "filename" }))).toBe("hold");
    expect(isIdentified({ name: null, player: "Shohei Ohtani", identSource: "manifest" })).toBe(true);
  });

  it("a card with no usable photo is held; a later copy of the exact same scan waits for me", () => {
    expect(decide(c({ readable: false }))).toBe("hold");
    expect(decide(c({ frontImage: null }))).toBe("hold");
    expect(decide(c(), true)).toBe("review");
  });

  it("a named card with no price source is published at $1 (shopPrice gives it $1)", async () => {
    const { shopPrice } = await import("@/lib/pricing/engine");
    expect(decide(c({ listPrice: shopPrice(null) }))).toBe("publish");
  });
});

describe("cute-shop copy", () => {
  it("has the four disclaimers", () => {
    expect(DISCLAIMERS).toEqual([
      "For fun, not a grade. Photos are of the cards in the pack or listing.",
      "Prices are a cute-shop estimate, not a market quote.",
      "A Lil’ Stack shows every card before you pay.",
      "Shipping is calculated at checkout.",
    ]);
  });

  it("descriptions sound like a friend and never talk investment or gem grades", () => {
    const base = { id: "x", game: "Pokemon", name: "Pikachu", setName: "151", number: "025/165", year: "2023", variant: null, rarity: null, player: null, team: null, condition: "NM", graded: null } as never;
    const d = renderDescription(base, S);
    expect(d).toContain("not a grade");
    expect(d).not.toMatch(/invest|gem mint|guarantee/i);
    const slab = renderDescription({ ...(base as object), graded: "PSA 10" } as never, S);
    expect(slab).toContain("PSA 10 slab");
    expect(friendly("Great card. A solid investment piece! Gem Mint for sure. Ships fast.")).toBe("Great card. Ships fast.");
    const custom = renderDescription(base, { ...S, descriptionTemplate: "{name}. A blue-chip grail, guaranteed to appreciate. Fun pull!" });
    expect(custom).toBe("Pikachu. Fun pull!");
  });
});
