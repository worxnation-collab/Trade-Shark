import type { Settings } from "../settings";

export interface ListingCard {
  game: string;
  name: string | null;
  setName: string | null;
  number: string | null;
  year: string | null;
  variant: string | null;
  rarity: string | null;
  player: string | null;
  team: string | null;
  condition: string;
  graded: string | null;
}

export const CONDITION_LONG: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

function vars(c: ListingCard, s: Settings): Record<string, string> {
  const num = c.number ? `#${c.number}` : "";
  return {
    name: c.player || c.name || "",
    player: c.player ?? "",
    team: c.team ?? "",
    set: c.setName ?? "",
    number: num,
    year: c.year ?? "",
    variant: c.variant ?? "",
    rarity: c.rarity ?? "",
    game: c.game,
    grade: c.graded ?? "",
    condition: c.graded ? "" : c.condition,
    condition_long: c.graded ? `Graded ${c.graded}` : CONDITION_LONG[c.condition] ?? c.condition,
    grade_line: "",
    condition_line: c.graded
      ? `It comes in its ${c.graded} slab.`
      : `Looks ${CONDITION_LONG[c.condition] ?? c.condition} to me, but that's just my eyeball, not a grade.`,
    variant_line: c.variant ? `This one's the ${c.variant}.` : "",
    shop_note: s.shopNote,
  };
}

function fill(tpl: string, v: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
}

/** eBay titles max out at 80 chars; drop trailing words rather than cutting mid-word. */
export function renderTitle(c: ListingCard, s: Settings, max = 80) {
  let t = fill(s.titleTemplate, vars(c, s)).replace(/\s+/g, " ").trim();
  while (t.length > max && t.includes(" ")) t = t.slice(0, t.lastIndexOf(" "));
  return t.slice(0, max);
}

/** Words a friendly collector shop never uses: no investment talk, no gem/grade promises. */
const NOT_OUR_VIBE = /\b(invest(ment|ing|or)?s?|gem[\s-]?mint|graded gem|guaranteed?|appreciat\w*|roi|blue[\s-]?chip|grail)\b/i;

/** Drop any sentence that slips into investment or grading-promise language. */
export function friendly(text: string) {
  return text
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !NOT_OUR_VIBE.test(sentence))
        .join(" "),
    )
    .join("\n");
}

export function renderDescription(c: ListingCard, s: Settings) {
  return friendly(fill(s.descriptionTemplate, vars(c, s)))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").replace(/\s+from\s*\./, ".").replace(/\s+([.,!?])/g, "$1").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
