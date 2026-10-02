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

  it("pairs untokened files front-then-back in natural order", () => {
    const g = pairFiles([f("IMG_10.jpg"), f("IMG_2.jpg"), f("IMG_1.jpg"), f("IMG_9.jpg"), f("IMG_11.jpg")]);
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
