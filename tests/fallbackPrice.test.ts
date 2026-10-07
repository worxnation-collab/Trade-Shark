import { describe, expect, it } from "vitest";
import { numKey, pickJustTcg } from "@/lib/sources/justtcg";
import { pcQuery } from "@/lib/sources/pricecharting";
import { suggest } from "@/lib/pricing/engine";
import { NO_PRICE, holdWhy, trayFor } from "@/lib/desk";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const nmv = (price: number, printing = "Normal") => ({ condition: "Near Mint", printing, price });

describe("JustTCG match", () => {
  const cards = [
    { name: "Snom", set_name: "Chilling Reign", number: "063/198", variants: [nmv(0.12)] },
    { name: "Snom", set_name: "Paldea Evolved", number: "042/132", variants: [nmv(0.3, "Reverse Holofoil"), nmv(0.27)] },
  ];
  it("takes the Near Mint normal price of the card whose number matches", () => {
    expect(pickJustTcg(cards, { name: "Snom", number: "42/132" })?.price).toBe(0.27);
    expect(numKey("074/172")).toBe("74");
  });
  it("never takes another printing's price when the number doesn't match", () => {
    expect(pickJustTcg(cards, { name: "Snom", number: "99/132" })).toBeNull();
  });
  it("won't pick between two equal matches without a number", () => {
    expect(pickJustTcg(cards, { name: "Snom" })).toBeNull();
  });
});

describe("PriceCharting query", () => {
  it("is year, set, player and number", () => {
    expect(pcQuery({ player: "Josh Allen", year: "2021", setName: "Panini Prizm", number: "1/300" })).toBe("2021 Panini Prizm Josh Allen #1");
  });
});

describe("unpriced cards", () => {
  it("a fallback quote prices the card; no quote leaves it null", () => {
    const at = new Date();
    const q = { source: "justtcg", kind: "market", label: "market", amount: 0.27, currency: "USD", condition: "NM", rawTitle: null, excluded: false, fetchedAt: at };
    expect(suggest([q], { condition: "NM" }, DEFAULT_SETTINGS as never).price).toBe(0.27);
    expect(suggest([], { condition: "NM" }, DEFAULT_SETTINGS as never).price).toBeNull();
  });
  it("go to the Unpriced column, not Hold; a real problem still holds", () => {
    const base = { status: "Identified", holdReason: null, listPrice: null, partnerId: "matthew", senderId: null };
    expect(holdWhy(base, false)).toBe(NO_PRICE);
    expect(trayFor(base, false)).toBe("U");
    expect(trayFor({ ...base, status: "NeedsLook", holdReason: "same scan uploaded twice" }, false)).toBe("H");
    expect(trayFor({ ...base, listPrice: 0.2 }, false)).toBe("A");
  });
});
