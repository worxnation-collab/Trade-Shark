import { describe, expect, it } from "vitest";
import { drawPack, packProblem, type PoolCard, type Rng } from "@/lib/game/rules";
import { holdWhy, trayFor } from "@/lib/desk";

function seeded(seed = 7): Rng {
  let s = seed >>> 0;
  return (n) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % n;
  };
}
const many = (n: number, price: number, p: string, extra: Partial<PoolCard> = {}): PoolCard[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, price, ident: `${p}${i}`, ...extra }));

describe("pack rules", () => {
  it("rejects a duplicate card, three of one Pokémon type, three of one player, with a one-line reason", () => {
    const ok = many(12, 0.3, "x");
    expect(packProblem(ok)).toBe(null);
    expect(packProblem([...ok.slice(0, 11), { id: "dup", price: 0.3, ident: "x0" }])).toBe("duplicate card");
    const grass = ok.map((c, i) => ({ ...c, type: i < 3 ? "Grass" : null }));
    expect(packProblem(grass)).toBe("more than 2 Grass Pokémon");
    expect(packProblem(ok.map((c, i) => ({ ...c, type: i < 2 ? "Grass" : null })))).toBe(null);
    const trout = ok.map((c, i) => ({ ...c, player: i < 3 ? "Mike Trout" : null }));
    expect(packProblem(trout)).toBe("more than 2 cards of Mike Trout");
  });

  it("the builder throws illegal draws out and says why when it can't make a legal pack", () => {
    // Every bulk card is Grass: any pack has 7 Grass → never legal.
    const pool = [...many(30, 0.1, "b", { type: "Grass" }), ...many(20, 0.5, "m"), ...many(5, 1, "t")];
    const why = new Map<string, number>();
    expect(drawPack(pool, seeded(), 50, "base", why)).toBe(null);
    expect([...why.keys()]).toEqual(["more than 2 Grass Pokémon"]);
    // Mixed types: legal packs come out.
    const types = ["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Dragon", "Colorless"];
    const mixed = [...many(40, 0.1, "b").map((c, i) => ({ ...c, type: types[i % types.length] })), ...many(20, 0.5, "m"), ...many(5, 1, "t")];
    const p = drawPack(mixed, seeded(), 400, "base")!;
    expect(p).not.toBe(null);
    expect(packProblem(mixed.filter((c) => p.ids.includes(c.id)))).toBe(null);
  });
});

describe("desk trays", () => {
  const base = { status: "Priced", holdReason: null, listPrice: 0.1, partnerId: "mike", senderId: null };
  it("value trays A–D, Hold for anything that needs fixing first", () => {
    expect(trayFor(base, false)).toBe("A");
    expect(trayFor({ ...base, listPrice: 0.5 }, false)).toBe("B");
    expect(trayFor({ ...base, listPrice: 1.5 }, false)).toBe("C");
    expect(trayFor({ ...base, listPrice: 6 }, false)).toBe("D");
    expect(trayFor({ ...base, listPrice: 25 }, false)).toBe("H");
    expect(trayFor({ ...base, listPrice: 25 }, true)).toBe("D");
    expect(trayFor({ ...base, holdReason: "rotation", status: "NeedsLook" }, false)).toBe("H");
    expect(trayFor({ ...base, partnerId: null }, false)).toBe("H");
    expect(holdWhy({ ...base, holdReason: "rotation", status: "NeedsLook" }, false)).toBe("sideways? tap to turn");
    expect(holdWhy({ ...base, partnerId: null }, false)).toBe("no owner tag");
  });
});
