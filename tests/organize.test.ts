/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { parseManifest, matchManifest } from "@/lib/organize/manifest";
import { pairFiles, sniffImage } from "@/lib/organize/pairing";
import { detectGame, parseText, sideOf } from "@/lib/organize/parse";

const f = (name: string, readable = true) => ({ name, readable });

describe("pairing", () => {
  it("pairs -front/-back and _f/_b tokens", () => {
    const g = pairFiles([f("card001-front.jpg"), f("card001-back.jpg"), f("card002_f.jpg"), f("card002_b.jpg")]);
    expect(g).toHaveLength(2);
    expect(g.every((x) => x.method === "filename" && x.front && x.back)).toBe(true);
    expect(g[0].front!.name).toBe("card001-front.jpg");
    expect(g[0].back!.name).toBe("card001-back.jpg");
  });

  it("puts orphans in Unpaired and unreadables in Unreadable", () => {
    const g = pairFiles([f("a-front.jpg"), f("b-front.jpg"), f("b-back.jpg"), f("junk.heic", false)]);
    expect(g.find((x) => x.front?.name === "a-front.jpg")!.pile).toBe("unpaired");
    expect(g.find((x) => x.front?.name === "junk.heic")!.pile).toBe("unreadable");
  });

  it("Order mode pairs untokened files front-then-back in natural order", () => {
    const g = pairFiles([f("IMG_10.jpg"), f("IMG_2.jpg"), f("IMG_1.jpg"), f("IMG_9.jpg"), f("IMG_11.jpg")], "order");
    expect(g.map((x) => [x.front?.name, x.back?.name])).toEqual([
      ["IMG_1.jpg", "IMG_2.jpg"],
      ["IMG_9.jpg", "IMG_10.jpg"],
      ["IMG_11.jpg", undefined],
    ]);
    expect(g[2].pile).toBe("unpaired");
  });

  it("fronts-only mode never pairs", () => {
    const g = pairFiles([f("a.jpg"), f("b.jpg")], "fronts");
    expect(g.every((x) => !x.back && x.pile === "none")).toBe(true);
  });

  it("keeps folders separate", () => {
    const g = pairFiles([f("box1/card1-front.jpg"), f("box2/card1-back.jpg")]);
    expect(g.every((x) => x.pile === "unpaired")).toBe(true);
  });
});

describe("sniff", () => {
  it("detects jpeg/png and rejects junk", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])).mime).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])).readable).toBe(true);
    expect(sniffImage(new TextEncoder().encode("hello world, not an image")).readable).toBe(false);
  });
});

describe("filename + line parsing", () => {
  it("strips side tokens", () => {
    expect(sideOf("card001-front")).toEqual({ base: "card001", side: "front" });
    expect(sideOf("charizard_b")).toEqual({ base: "charizard", side: "back" });
    expect(sideOf("bob").side).toBeNull();
  });

  it("parses a Pokemon filename", () => {
    const p = parseText("1999_base-set_4-102_charizard_holo_front.jpg", { isFilename: true });
    expect(p.fields).toMatchObject({ year: "1999", number: "4/102", name: "Charizard", variant: "Holo", game: "Pokemon" });
    expect(p.fields.setName).toBe("Base");
  });

  it("parses a pasted sports line", () => {
    const p = parseText("2018 Topps Chrome Shohei Ohtani #150 Rookie Refractor");
    expect(p.fields.year).toBe("2018");
    expect(p.fields.number).toBe("150");
    expect(p.fields.game).toBe("Sports");
    expect(p.fields.player).toBe("Shohei Ohtani");
    expect(p.fields.variant).toContain("Refractor");
  });

  it("parses grades", () => {
    expect(parseText("PSA 10 Pikachu 58/102").fields.graded).toBe("PSA 10");
  });

  it("ignores generic scan names", () => {
    expect(parseText("IMG_0042", { isFilename: true }).fields.name).toBeUndefined();
  });

  it("detects games", () => {
    expect(detectGame("mtg lightning bolt").game).toBe("Magic");
    expect(detectGame("random thing").game).toBe("Other");
  });

  it("flags bulk", () => {
    expect(parseText("bulk_commons_014", { isFilename: true }).bulkHint).toBe(true);
  });
});

describe("manifest", () => {
  const csv = `filename,name,set,number,condition,cost,game
card001-front.jpg,Charizard,Base,4/102,Lightly Played,"$1,200.00",pokemon
card002-front.jpg,"Lightning Bolt, Again",M10,146,NM,2,MTG`;
  it("parses aliases, quotes, money", () => {
    const rows = parseManifest(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ cost: 1200, fields: { name: "Charizard", condition: "LP", game: "Pokemon" } });
    expect(rows[1].fields.name).toBe("Lightning Bolt, Again");
    expect(rows[1].fields.game).toBe("Magic");
  });
  it("matches by filename stem", () => {
    const rows = parseManifest(csv);
    expect(matchManifest(rows, "card002-front.png", "card002-back.png", 0)?.fields.name).toBe("Lightning Bolt, Again");
  });
});

describe("flatbed explicit pairs", () => {
  it("pairs by sheet position, never by name or order, and keeps front-only crops out of Unpaired", () => {
    const files = [
      { name: "batch-002.jpg", readable: true, pairKey: "fb1-002", side: "front" },
      { name: "batch-001-back.jpg", readable: true, pairKey: "fb1-001", side: "back" },
      { name: "batch-001.jpg", readable: true, pairKey: "fb1-001", side: "front" },
      { name: "batch-003.jpg", readable: true, pairKey: "fb1-003", side: "front" },
      { name: "loose-front.jpg", readable: true },
      { name: "loose-back.jpg", readable: true },
    ];
    const g = pairFiles(files);
    const sheet = g.filter((x) => x.method === "sheet");
    expect(sheet.map((x) => [x.front?.name, x.back?.name, x.pile])).toEqual([
      ["batch-001.jpg", "batch-001-back.jpg", "none"],
      ["batch-002.jpg", undefined, "none"],
      ["batch-003.jpg", undefined, "none"],
    ]);
    // Loose feeder files still pair the old way.
    expect(g.find((x) => x.front?.name === "loose-front.jpg")?.back?.name).toBe("loose-back.jpg");
  });
});

// Synthetic 256-bit fingerprints: unrelated fronts are random; backs are small mutations of one design.
// mulberry32: small, well-mixed, integer-safe PRNG.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
function randomHash(seed: number) {
  const r = rng(seed);
  return Array.from({ length: 64 }, () => (r() % 16).toString(16)).join("");
}
function mutate(hex: string, bits: number, seed: number) {
  const r = rng(seed);
  const arr = hex.split("").map((c) => parseInt(c, 16));
  for (let k = 0; k < bits; k++) {
    const i = r() % 64;
    arr[i] ^= 1 << (r() % 4);
  }
  return arr.map((v) => v.toString(16)).join("");
}
const BACK = randomHash(999);
const pf = (name: string, phash: string) => ({ name, readable: true, phash });

describe("Auto detects whether a batch has backs", () => {
  it("pairs when every other file is a back", () => {
    const files = [1, 2, 3, 4].flatMap((n) => [pf(`IMG_${n * 2 - 1}.jpg`, randomHash(n)), pf(`IMG_${n * 2}.jpg`, mutate(BACK, 18, n))]);
    let d: any;
    const g = pairFiles(files, "auto", { onDecision: (x) => (d = x) });
    expect(d.result).toBe("pairs");
    expect(g.map((x) => [x.front?.name, x.back?.name])).toEqual([
      ["IMG_1.jpg", "IMG_2.jpg"],
      ["IMG_3.jpg", "IMG_4.jpg"],
      ["IMG_5.jpg", "IMG_6.jpg"],
      ["IMG_7.jpg", "IMG_8.jpg"],
    ]);
  });

  it("treats a fronts-only batch as fronts, even with a duplicate front in it", () => {
    const dupe = randomHash(42);
    const files = [pf("one.jpg", randomHash(1)), pf("two.jpg", dupe), pf("three.jpg", randomHash(3)), pf("four.jpg", mutate(dupe, 6, 1)), pf("five.jpg", randomHash(5))];
    let d: any;
    const g = pairFiles(files, "auto", { onDecision: (x) => (d = x) });
    expect(d.result).toBe("fronts");
    expect(g).toHaveLength(5);
    expect(g.every((x) => !x.back && x.pile === "none")).toBe(true);
  });

  it("swaps when backs come first", () => {
    const files = [1, 2, 3].flatMap((n) => [pf(`s${n}a.jpg`, mutate(BACK, 15, n)), pf(`s${n}b.jpg`, randomHash(n + 10))]);
    let d: any;
    const g = pairFiles(files, "auto", { onDecision: (x) => (d = x) });
    expect(d.result).toBe("pairs-backs-first");
    expect(g.map((x) => [x.front?.name, x.back?.name])).toEqual([
      ["s1b.jpg", "s1a.jpg"],
      ["s2b.jpg", "s2a.jpg"],
      ["s3b.jpg", "s3a.jpg"],
    ]);
  });

  it("recognizes a one-card front+back upload from backs already in inventory", () => {
    const files = [pf("IMG_1.jpg", randomHash(7)), pf("IMG_2.jpg", mutate(BACK, 20, 3))];
    let d: any;
    const g = pairFiles(files, "auto", { knownBacks: [BACK], onDecision: (x) => (d = x) });
    expect(d.result).toBe("pairs");
    expect(g[0].back?.name).toBe("IMG_2.jpg");
    // Without that history the same two files stay two fronts.
    expect(pairFiles(files, "auto").length).toBe(2);
  });

  it("parks a stray back in Unpaired instead of making it a card", () => {
    const files = [pf("one.jpg", randomHash(1)), pf("two.jpg", randomHash(2)), pf("three.jpg", mutate(BACK, 12, 9)), pf("four.jpg", randomHash(4)), pf("five.jpg", randomHash(5))];
    let d: any;
    const g = pairFiles(files, "auto", { knownBacks: [BACK], onDecision: (x) => (d = x) });
    expect(d.result).toBe("fronts");
    expect(g.find((x) => x.front?.name === "three.jpg")?.pile).toBe("unpaired");
    expect(g.filter((x) => x.pile === "none")).toHaveLength(4);
  });
});

describe("Auto learns backs from the same batch", () => {
  it("a lone untokened back is recognized when another card's back is named in the batch", () => {
    const files = [
      { name: "zard-front.jpg", readable: true, phash: randomHash(70) },
      { name: "zard-back.jpg", readable: true, phash: mutate(BACK, 10, 70) },
      pf("IMG_0001.jpg", randomHash(71)),
      pf("IMG_0002.jpg", mutate(BACK, 22, 71)),
    ];
    let d: any;
    const g = pairFiles(files, "auto", { onDecision: (x) => (d = x) });
    expect(d.result).toBe("pairs");
    expect(g.find((x) => x.front?.name === "IMG_0001.jpg")?.back?.name).toBe("IMG_0002.jpg");
  });
});
