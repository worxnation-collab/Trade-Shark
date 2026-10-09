import { describe, expect, it } from "vitest";
import { numKey, pickJustTcg } from "@/lib/sources/justtcg";
import { pcQuery, pickPc, pickPokemonPc } from "@/lib/sources/pricecharting";
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

describe("PriceCharting match", () => {
  const P = (name: string, console: string, cents?: number) => ({ "product-name": name, "console-name": console, "loose-price": cents });
  const real = [
    P("Trey McBride #BCA-TMB", "Football Cards 2026 Bowman Chrome Autograph NFL"),
    P("Trey McBride [Gold] #1", "Football Cards 2026 Bowman", 900),
    P("Trey McBride #1", "Football Cards 2026 Bowman", 193),
    P("Trey McBride #1", "Funko POP NFL", 1500),
  ];
  it("takes the base card with the same number from a football set", () => {
    expect(pickPc(real, { player: "Trey McBride", year: "2026", number: "1" })?.["loose-price"]).toBe(193);
    expect(pcQuery({ player: "Trey McBride", year: "2026", setName: "Topps Bowman", number: "1" })).toBe("Trey McBride 2026 Bowman #1");
  });
  it("never prices from a Funko, another number, or without a number", () => {
    expect(pickPc([P("Patrick Mahomes II #119", "Funko POP Soccer", 539)], { player: "Patrick Mahomes II", number: "119" })).toBeNull();
    expect(pickPc(real, { player: "Trey McBride", year: "2026", number: "56" })).toBeNull();
    expect(pickPc(real, { player: "Trey McBride", year: "2026" })).toBeNull();
  });
  it("won't choose between two different sets", () => {
    expect(pickPc([P("Joe Burrow #9", "Football Cards 2026 Bowman", 100), P("Joe Burrow #9", "Football Cards 2026 Topps", 300)], { player: "Joe Burrow", number: "9" })).toBeNull();
  });
});

describe("PriceCharting Pokemon match", () => {
  const P = (name: string, console: string, cents?: number) => ({ "product-name": name, "console-name": console, "loose-price": cents });
  const res = [P("Jirachi EX #98", "Pokemon Plasma Blast", 8153), P("Jirachi #98", "Pokemon Stellar Crown", 40), P("Jirachi [Reverse Holo] #98", "Pokemon Stellar Crown", 105)];
  it("exact name and number, base print", () => {
    expect(pickPokemonPc(res, { name: "Jirachi", number: "98/142" })?.["loose-price"]).toBe(40);
    expect(pickPokemonPc(res, { name: "Jirachi", number: "98/142", variant: "Reverse Holo" })?.["loose-price"]).toBe(105);
  });
  it("never another Pokemon, number, or language", () => {
    expect(pickPokemonPc(res, { name: "Jirachi", number: "99/142" })).toBeNull();
    expect(pickPokemonPc([P("Snom #42", "Pokemon Japanese Mega", 30)], { name: "Snom", number: "42" })).toBeNull();
    expect(pickPokemonPc([P("Snom #42", "Pokemon Mega Evolution", 49)], { name: "Cinccino (奇诺栗鼠)", number: "42" })).toBeNull();
  });
  it("uses the set name to choose between two sets, else no price", () => {
    const two = [P("Pikachu #25", "Pokemon Celebrations", 300), P("Pikachu #25", "Pokemon Base Set", 900)];
    expect(pickPokemonPc(two, { name: "Pikachu", number: "25", setName: "Celebrations" })?.["loose-price"]).toBe(300);
    expect(pickPokemonPc(two, { name: "Pikachu", number: "25" })).toBeNull();
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

describe("energy cards", () => {
  it("go to the side bin, never a value tray", async () => {
    const { isEnergy } = await import("@/lib/game/packs");
    expect(isEnergy("Basic Grass Energy")).toBe(true);
    expect(isEnergy("Double Turbo Energy")).toBe(true);
    expect(isEnergy("Energy")).toBe(true);
    expect(isEnergy("Snom")).toBe(false);
    expect(trayFor({ status: "Priced", holdReason: null, listPrice: 0.1, partnerId: "matthew", senderId: null, name: "Basic Grass Energy" }, false)).toBe("E");
  });
});
