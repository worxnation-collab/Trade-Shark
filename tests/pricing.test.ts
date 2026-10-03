import { describe, expect, it } from "vitest";
import { ebayDraftCsv, tcgplayerCsv, toCsv } from "@/lib/listing/export";
import { renderTitle } from "@/lib/listing/templates";
import { mergeCandidates } from "@/lib/identify/merge";
import { netAfterFees, statusAfterPricing, suggest, type QuoteRow } from "@/lib/pricing/engine";
import { DEFAULT_SETTINGS as S } from "@/lib/settings";
import { filterComps, parsePastedComps } from "@/lib/sources/comps";

const now = new Date();
const q = (o: Partial<QuoteRow>): QuoteRow => ({
  source: "pasted",
  kind: "sold_comp",
  label: "comp",
  amount: 10,
  currency: "USD",
  condition: null,
  rawTitle: "Charizard",
  excluded: false,
  fetchedAt: now,
  ...o,
});

describe("pasted comps", () => {
  it("parses eBay sold layout and one-line comps", () => {
    const block = `Sold  Sep 20, 2026
Charizard 4/102 Base Set Holo Rare WOTC
$450.00
+$5.00 delivery
Sold  Sep 18, 2026
New Listing Charizard 4/102 Base Holo LP
$399.99
Charizard Base Set 4/102 holo - $420
Lot of 10 Pokemon cards Charizard $25.00`;
    const c = parsePastedComps(block);
    expect(c.map((x) => x.amount)).toEqual([450, 399.99, 420, 25]);
    expect(c[0].soldAt?.getFullYear()).toBe(2026);
    expect(c[1].title).toContain("Charizard 4/102 Base Holo LP");
    const f = filterComps(c, { name: "Charizard", number: "4/102" });
    expect(f[3].excluded).toBe(true);
    expect(f[3].excludeReason).toBe("lot/bundle");
    expect(f.slice(0, 3).every((x) => !x.excluded)).toBe(true);
  });

  it("excludes graded comps for a raw card, wrong numbers, and outliers", () => {
    const comps = [
      { title: "Pikachu 58/102 PSA 9", amount: 80, currency: "USD" },
      { title: "Pikachu 60/64 Jungle", amount: 3, currency: "USD" },
      { title: "Pikachu 58/102 Base", amount: 5, currency: "USD" },
      { title: "Pikachu 58/102 Base NM", amount: 6, currency: "USD" },
      { title: "Pikachu 58/102 red cheeks", amount: 5.5, currency: "USD" },
      { title: "Pikachu 58/102", amount: 4.5, currency: "USD" },
      { title: "Pikachu 58/102 shiny", amount: 60, currency: "USD" },
    ];
    const f = filterComps(comps, { name: "Pikachu", number: "58/102" });
    expect(f[0].excludeReason).toMatch(/graded/);
    expect(f[1].excludeReason).toMatch(/different number/);
    expect(f[6].excludeReason).toMatch(/outlier/);
  });
});

describe("suggested price rule", () => {
  const card = { condition: "NM", graded: null, manualPrice: null };
  it("takes the median of every source that has a number", () => {
    const sold = [q({ amount: 10 }), q({ amount: 12 }), q({ amount: 30 })]; // sold median 12
    const market = q({ source: "pokemontcg", kind: "market", label: "market", amount: 50, condition: "NM" });
    const ask = q({ source: "scryfall", kind: "retail_ask", label: "usd", amount: 4, condition: "NM" });
    const r = suggest([...sold, market, ask], card, S);
    expect(r.basis).toBe("median");
    expect(r.basisLabel).toBe("Median of 3 sources");
    expect(r.price).toBe(12); // median of 12, 50, 4
    expect(r.conflict).toBe(true); // recorded, never a reason to hold
  });
  it("one source = that number; even a single comp counts; none = null", () => {
    const m = q({ source: "pokemontcg", kind: "market", label: "market", amount: 8, condition: "NM" });
    expect(suggest([m], card, S)).toMatchObject({ basis: "single", price: 8, basisLabel: "TCGplayer market" });
    expect(suggest([q({ amount: 7 })], card, S).price).toBe(7);
    expect(suggest([q({ source: "scryfall", kind: "retail_ask", label: "usd", amount: 3, condition: "NM" })], card, S).price).toBe(3);
    expect(suggest([], card, S)).toMatchObject({ price: null, basis: null });
    // Two sources: the median is their average
    expect(suggest([m, q({ amount: 12 })], card, S).price).toBe(10);
  });
  it("shop price: nearest dollar, minimum $1, $1 with no source, exact under $1 (Lil' Stack)", async () => {
    const { shopPrice } = await import("@/lib/pricing/engine");
    expect(shopPrice(4.49)).toBe(4);
    expect(shopPrice(4.5)).toBe(5);
    expect(shopPrice(5.4)).toBe(5);
    expect(shopPrice(5.5)).toBe(6);
    expect(shopPrice(1.2)).toBe(1);
    expect(shopPrice(null)).toBe(1);
    expect(shopPrice(0.37)).toBe(0.37);
    expect(shopPrice(3.2, 9.99)).toBe(9.99); // manual wins as typed
  });
  it("applies condition multiplier only to NM-source prices", () => {
    const m = q({ source: "pokemontcg", kind: "market", label: "market", amount: 10, condition: "NM" });
    expect(suggest([m], { ...card, condition: "LP" }, S).price).toBe(8.5);
    const comps = [q({ amount: 10 }), q({ amount: 10 }), q({ amount: 10 })];
    expect(suggest(comps, { ...card, condition: "HP" }, S).price).toBe(10);
  });
  it("manual wins", () => {
    const r = suggest([q({ amount: 10 }), q({ amount: 10 }), q({ amount: 10 })], { ...card, manualPrice: 99 }, S);
    expect(r.price).toBe(99);
    expect(r.basisLabel).toBe("Manual");
  });
  it("ignores stale fetches from the same source", () => {
    const old = new Date(Date.now() - 3 * 86400_000);
    const r = suggest([q({ source: "pokemontcg", kind: "market", label: "market", amount: 100, condition: "NM", fetchedAt: old }), q({ source: "pokemontcg", kind: "market", label: "market", amount: 7, condition: "NM" })], card, S);
    expect(r.price).toBe(7);
  });
  it("status: bulk hold under minimum, never past Priced", () => {
    expect(statusAfterPricing("Identified", 1.5, true, S)).toBe("BulkHold");
    expect(statusAfterPricing("Identified", 5, true, S)).toBe("Priced");
    expect(statusAfterPricing("Inbox", 5, false, S)).toBe("Inbox");
    expect(statusAfterPricing("Listed", 1, true, S)).toBe("Listed");
  });
  it("fee math", () => {
    expect(netAfterFees(10, "ebay", "standard", S)).toEqual({ fees: 1.73, ship: 1, net: 7.27 });
    expect(netAfterFees(10, "tcgplayer", "bubble", S)).toEqual({ fees: 1.33, ship: 4.5, net: 4.17 });
    expect(netAfterFees(10, "local", "slab", S).net).toBe(10);
  });
});

describe("identification merge", () => {
  it("boosts a catalog match that agrees with vision, flags disagreement", () => {
    const vision = { source: "vision:anthropic", confidence: 0.7, fields: { name: "Charizard", number: "4/102" } };
    const cat = { source: "pokemontcg", confidence: 0.8, fields: { name: "Charizard", number: "4/102", setName: "Base" }, catalogId: "base1-4" };
    const m = mergeCandidates([vision, cat]);
    expect(m.winner?.catalogId).toBe("base1-4");
    expect(m.confidence).toBeGreaterThan(0.9);
    expect(m.conflict).toBe(false);
    const bad = mergeCandidates([vision, { ...cat, fields: { name: "Blastoise", number: "2/102" } }]);
    expect(bad.conflict).toBe(true);
  });
});

describe("exports", () => {
  const card = {
    id: "c1", game: "Pokemon", name: "Charizard", setName: "Base", number: "4/102", year: "1999", variant: "Holo",
    rarity: "Rare Holo", player: null, team: null, condition: "LP", graded: null, title: null, description: null,
    listPrice: 400, suggestedPrice: 420, quantity: 1, backImage: "x", tcgplayerId: null,
  } as never;
  it("eBay draft CSV uses Draft action and escapes", () => {
    const csv = ebayDraftCsv([card], S, "https://shop.example");
    const [head, row] = csv.trim().split("\r\n");
    expect(head.startsWith("*Action(")).toBe(true);
    expect(row.startsWith("Draft,c1,183454,")).toBe(true);
    expect(row).toContain("https://shop.example/api/shop/image/c1/front|https://shop.example/api/shop/image/c1/back");
  });
  it("TCGplayer CSV", () => {
    expect(tcgplayerCsv([card], S, "").split("\r\n")[1]).toContain("Lightly Played");
  });
  it("csv escaping", () => {
    expect(toCsv([["a,b", 'say "hi"', null]])).toBe('"a,b","say ""hi""",\r\n');
  });
  it("title ≤ 80 chars", () => {
    const t = renderTitle({ ...(card as object), name: "A Very Long Card Name ".repeat(6) } as never, S);
    expect(t.length).toBeLessThanOrEqual(80);
  });
});

describe("set size guards against other-language printings", () => {
  it("a /151 card never confidently matches the /165 English printing", async () => {
    const { scoreCandidate } = await import("@/lib/sources/score");
    const same = scoreCandidate({ name: "Persian", number: "053/165" }, { name: "Persian", number: "53", setName: "151", printedTotal: 165 });
    const other = scoreCandidate({ name: "Persian", number: "053/151" }, { name: "Persian", number: "53", setName: "151", printedTotal: 165 });
    expect(same.score).toBeGreaterThan(0.85);
    expect(other.score).toBeLessThan(0.8);
    const m = mergeCandidates([
      { source: "pasted", confidence: 0.7, fields: { name: "Persian", number: "053/151" } },
      { source: "pokemontcg", confidence: other.score, fields: { name: "Persian", number: "53/165", setName: "151" }, catalogId: "sv3pt5-53" },
    ]);
    expect(m.confidence).toBeLessThan(0.8);
  });
});

describe("retired catalog quotes", () => {
  it("an excluded market price no longer drives the suggestion", () => {
    const r = suggest([q({ source: "pokemontcg", kind: "market", label: "market", amount: 9, condition: "NM", excluded: true })], { condition: "NM", graded: null, manualPrice: null }, S);
    expect(r.price).toBeNull();
  });
});

describe("a confident read beats a disagreeing catalog guess", () => {
  it("keeps the pasted line's number and flags the conflict", () => {
    const m = mergeCandidates([
      { source: "pasted", confidence: 0.65, fields: { game: "Pokemon", name: "Electrike", number: "037/063" } },
      { source: "pokemontcg", confidence: 0.7, fields: { name: "Electrike", number: "49/132", setName: "Mega Evolution" }, catalogId: "me1-49" },
    ]);
    expect(m.winner?.source).toBe("pasted");
    expect(m.fields.number).toBe("037/063");
    expect(m.conflict).toBe(true);
    expect(m.alternates.some((a) => a.catalogId === "me1-49")).toBe(true);
  });
  it("a weak filename guess still loses to the catalog", () => {
    const m = mergeCandidates([
      { source: "filename", confidence: 0.45, fields: { name: "Img Charizard Thing" } },
      { source: "pokemontcg", confidence: 0.7, fields: { name: "Charizard", number: "4/102" }, catalogId: "base1-4" },
    ]);
    expect(m.winner?.catalogId).toBe("base1-4");
  });
});

describe("rejected catalog guesses don't leak fields", () => {
  it("a winning read doesn't borrow the set name from a catalog match it disagrees with", () => {
    const m = mergeCandidates([
      { source: "pasted", confidence: 0.7, fields: { game: "Pokemon", name: "Quaxly", number: "003/015" } },
      { source: "pokemontcg", confidence: 0.65, fields: { name: "Quaxly", number: "3/215", setName: "Black Star Promos" }, catalogId: "svp-3" },
    ]);
    expect(m.winner?.source).toBe("pasted");
    expect(m.fields.setName).toBeUndefined();
  });
});
