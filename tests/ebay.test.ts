import { describe, expect, it } from "vitest";
import { ebayCategory, ebayTitle, idOfSku, skuOf } from "../lib/ebay/seller";

describe("eBay lane", () => {
  it("sku round-trips the card id and ignores foreign skus", () => {
    expect(idOfSku(skuOf("abc123"))).toBe("abc123");
    expect(idOfSku("OTHER-1")).toBeNull();
    expect(idOfSku(undefined)).toBeNull();
  });
  it("titles from year, set, name, variant, number", () => {
    expect(ebayTitle({ game: "Pokemon", name: "Pikachu", player: null, setName: "Scarlet & Violet", number: "25", year: "2023", variant: null })).toBe("2023 Scarlet & Violet Pikachu #25");
    expect(ebayTitle({ game: "Sports", name: "Card", player: "Josh Allen", setName: "Bowman", number: "7", year: "2026", variant: "Refractor" })).toBe("2026 Bowman Josh Allen Refractor #7");
  });
  it("keeps titles to 80 characters", () => {
    const t = ebayTitle({ game: "Pokemon", name: "Pikachu", player: null, setName: "x".repeat(90), number: "25", year: "2023", variant: null });
    expect(t).toBe("Pikachu #25");
  });
  it("no name, no title", () => {
    expect(ebayTitle({ game: "Pokemon", name: null, player: null, setName: null, number: null, year: null, variant: null })).toBe("");
  });
  it("Pokemon goes to CCG singles, sports to sports singles", () => {
    expect(ebayCategory("pokemon")).toBe("183454");
    expect(ebayCategory("football")).toBe("261328");
  });
});
