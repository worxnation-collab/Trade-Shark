import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isShiny } from "@/lib/shiny";

const root = path.resolve(__dirname, "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** The pack is drawn from the fin and the stages are flat color: no generated art comes back. */
describe("brand", () => {
  it("ships no generated pack or stage images", () => {
    const dir = path.join(root, "public/brand");
    const images = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(webp|png|jpe?g|avif|gif)$/i.test(f)) : [];
    expect(images).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(root, "lib/brandScenes.json"), "utf8"))).toEqual({});
  });

  it("no source calls Gemini or points at the old art", () => {
    const files = ["app", "components", "lib", "scripts", "netlify"].flatMap((d) => walk(path.join(root, d))).filter((f) => /\.(tsx?|mjs|mts|js|css)$/.test(f));
    const bad = files.filter((f) => /gemini|generativelanguage|\/brand\/(pack|stage)-|import[^\n]*brandScenes/i.test(readFileSync(f, "utf8")));
    expect(bad.map((f) => path.relative(root, f))).toEqual([]);
  });

  it("only holo-type finishes shine", () => {
    for (const v of ["Holo", "Reverse Holo", "Holofoil", "Foil", "Refractor", "Gold Refractor", "Silver Parallel"]) expect(isShiny(v), v).toBe(true);
    for (const v of [null, "", "Base", "Normal", "1st Edition"]) expect(isShiny(v), String(v)).toBe(false);
  });
});
