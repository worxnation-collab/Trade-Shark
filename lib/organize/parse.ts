import type { CardFields, Game, IdentField } from "../types";
import { titleCase } from "../util";

/**
 * Pull whatever a filename or a pasted line already says: year, set, number, name, variant.
 * Deliberately conservative — confidence stays low so a catalog match or a human can win.
 */

export const POKEMON_SETS: Record<string, string> = {
  "base set": "Base", base: "Base", jungle: "Jungle", fossil: "Fossil", "team rocket": "Team Rocket",
  "gym heroes": "Gym Heroes", "gym challenge": "Gym Challenge", "neo genesis": "Neo Genesis",
  "neo discovery": "Neo Discovery", "neo revelation": "Neo Revelation", "neo destiny": "Neo Destiny",
  "base set 2": "Base Set 2", "legendary collection": "Legendary Collection", expedition: "Expedition Base Set",
  "evolving skies": "Evolving Skies", "brilliant stars": "Brilliant Stars", "lost origin": "Lost Origin",
  "silver tempest": "Silver Tempest", "crown zenith": "Crown Zenith", "astral radiance": "Astral Radiance",
  "fusion strike": "Fusion Strike", "chilling reign": "Chilling Reign", "battle styles": "Battle Styles",
  "vivid voltage": "Vivid Voltage", "shining fates": "Shining Fates", "hidden fates": "Hidden Fates",
  "champions path": "Champion's Path", "darkness ablaze": "Darkness Ablaze", "rebel clash": "Rebel Clash",
  "scarlet violet": "Scarlet & Violet", "paldea evolved": "Paldea Evolved", "obsidian flames": "Obsidian Flames",
  "151": "151", "paradox rift": "Paradox Rift", "paldean fates": "Paldean Fates", "temporal forces": "Temporal Forces",
  "twilight masquerade": "Twilight Masquerade", "shrouded fable": "Shrouded Fable", "stellar crown": "Stellar Crown",
  "surging sparks": "Surging Sparks", "prismatic evolutions": "Prismatic Evolutions", "journey together": "Journey Together",
  "destined rivals": "Destined Rivals", celebrations: "Celebrations", "pokemon go": "Pokémon GO",
  evolutions: "Evolutions", "cosmic eclipse": "Cosmic Eclipse", "team up": "Team Up", "unbroken bonds": "Unbroken Bonds",
};

export const SPORTS_BRANDS = [
  "topps", "bowman", "panini", "prizm", "donruss", "optic", "select", "mosaic", "upper deck", "fleer", "score",
  "leaf", "stadium club", "chrome", "finest", "heritage", "contenders", "national treasures", "flawless",
  "hoops", "spectra", "o-pee-chee", "skybox", "pinnacle", "playoff", "sp authentic", "allen ginter",
];
const SPORTS_WORDS = [
  "rookie", "rc", "nfl", "nba", "mlb", "nhl", "baseball", "football", "basketball", "hockey", "soccer", "ufc",
  "wnba", "auto", "autograph", "patch", "jersey", "refractor", "numbered",
];
const POKEMON_WORDS = [
  "pokemon", "pokémon", "pkmn", "ptcg", "holo", "reverse holo", "1st edition", "shadowless", "ex", "gx", "vmax",
  "vstar", "full art", "trainer gallery", "illustration rare", "energy", "pikachu", "charizard", "mewtwo", "eevee",
];
const MAGIC_WORDS = ["mtg", "magic", "magic the gathering", "planeswalker", "foil etched", "showcase", "borderless", "commander"];

const VARIANTS: [RegExp, string][] = [
  [/\b1st[\s-]?(ed|edition)?\b|\bfirst[\s-]edition\b/i, "1st Edition"],
  [/\bshadowless\b/i, "Shadowless"],
  [/\brev(erse)?[\s-]?holo\b/i, "Reverse Holo"],
  [/\bholo(foil)?\b/i, "Holo"],
  [/\bfoil[\s-]?etched\b|\betched\b/i, "Etched Foil"],
  [/\bnon[\s-]?foil\b/i, "Non-Foil"],
  [/\bfoil\b/i, "Foil"],
  [/\bfull[\s-]?art\b/i, "Full Art"],
  [/\balt(ernate)?[\s-]?art\b/i, "Alt Art"],
  [/\bpromo\b/i, "Promo"],
  [/\brefractor\b/i, "Refractor"],
  [/\bsilver\b/i, "Silver"],
  [/\b(rc|rookie)\b/i, "Rookie"],
  [/\bauto(graph)?\b/i, "Auto"],
  [/\bpatch\b/i, "Patch"],
  [/\bborderless\b/i, "Borderless"],
  [/\bshowcase\b/i, "Showcase"],
];

const SIDE_RE = /(?:^|[\s_\-.])(front|back|fr|bk|f|b)$/i;
const NOISE_RE = /^(card|img|image|scan|dsc|dscn|pxl|photo|picture|file|batch|page)\d*$/i;
const GRADE_RE = /\b(psa|bgs|cgc|sgc|tag)[\s-]?(\d{1,2}(?:\.5)?)\b/i;

export type Side = "front" | "back" | null;

export function sideOf(stem: string): { base: string; side: Side } {
  const m = stem.match(SIDE_RE);
  if (!m) return { base: stem, side: null };
  const tok = m[1].toLowerCase();
  const side: Side = ["front", "fr", "f"].includes(tok) ? "front" : "back";
  return { base: stem.slice(0, m.index), side };
}

export function stemOf(filename: string) {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.[a-z0-9]{2,5}$/i, "");
}

export interface ParseResult {
  fields: CardFields;
  fieldConfidence: Partial<Record<IdentField, number>>;
  confidence: number;
  bulkHint: boolean;
}

export function detectGame(text: string): { game: Game; confidence: number } {
  const t = ` ${text.toLowerCase()} `;
  const hit = (words: string[]) => words.filter((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(t)).length;
  const scores: [Game, number][] = [
    ["Pokemon", hit(POKEMON_WORDS) + hit(Object.keys(POKEMON_SETS)) * 2],
    ["Sports", hit(SPORTS_BRANDS) * 2 + hit(SPORTS_WORDS)],
    ["Magic", hit(MAGIC_WORDS) * 2],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  if (scores[0][1] === 0) return { game: "Other", confidence: 0.2 };
  const margin = scores[0][1] - scores[1][1];
  return { game: scores[0][0], confidence: margin >= 2 ? 0.75 : margin >= 1 ? 0.55 : 0.35 };
}

/**
 * Parse a free-text line: "1999 Base Set 4/102 Charizard Holo" or a filename stem
 * "1999_base-set_004-102_charizard_holo_front".
 */
export function parseText(input: string, opts: { isFilename?: boolean } = {}): ParseResult {
  let text = input;
  if (opts.isFilename) text = sideOf(stemOf(text)).base;
  text = text.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  const fields: CardFields = {};
  const fc: Partial<Record<IdentField, number>> = {};
  const base = opts.isFilename ? 0.45 : 0.6;
  let rest = ` ${text} `;
  const take = (re: RegExp) => {
    rest = rest.replace(re, " ");
  };

  const grade = rest.match(GRADE_RE);
  if (grade) {
    fields.graded = `${grade[1].toUpperCase()} ${grade[2]}`;
    take(GRADE_RE);
  }

  const year = rest.match(/(?:^|[\s\-])((?:19[5-9]\d|20[0-4]\d))(?:[\s\-]|$)/);
  if (year) {
    fields.year = year[1];
    fc.year = base + 0.2;
    rest = rest.replace(year[1], " ");
  }

  // "4/102", "4-102" (only when both sides numeric), "#4", "no 4", "4of102", "SWSH050", "TG12"
  const slash = rest.match(/(?:^|\s)#?([A-Za-z]{0,4}\d{1,4}[a-z]?)\s*(?:\/|of|-)\s*([A-Za-z]{0,4}\d{1,4})(?=\s|$)/i);
  const hash = rest.match(/(?:^|\s)(?:#|no\.?\s?)([A-Za-z]{0,4}\d{1,4}[a-z]?)(?=\s|$)/i);
  if (slash && !/^(19|20)\d\d$/.test(slash[1])) {
    fields.number = `${slash[1]}/${slash[2]}`;
    fc.number = base + 0.25;
    rest = rest.replace(slash[0], " ");
  } else if (hash) {
    fields.number = hash[1];
    fc.number = base + 0.2;
    rest = rest.replace(hash[0], " ");
  } else {
    const code = rest.match(/(?:^|\s)((?:swsh|sv|sm|xy|tg|gg|bw)\d{1,3})(?=\s|$)/i);
    if (code) {
      fields.number = code[1].toUpperCase();
      fc.number = base + 0.1;
      rest = rest.replace(code[0], " ");
    }
  }

  const variants: string[] = [];
  for (const [re, label] of VARIANTS) {
    if (re.test(rest)) {
      if (label === "Holo" && variants.includes("Reverse Holo")) continue;
      if (label === "Foil" && (variants.includes("Etched Foil") || variants.includes("Non-Foil"))) continue;
      variants.push(label);
      rest = rest.replace(re, " ");
    }
  }
  if (variants.length) {
    fields.variant = variants.join(" ");
    fc.variant = base;
  }

  const lower = rest.toLowerCase().replace(/[\-]+/g, " ");
  const setKey = Object.keys(POKEMON_SETS)
    .sort((a, b) => b.length - a.length)
    .find((k) => k !== "base" && new RegExp(`(^|\\s)${k}(\\s|$)`).test(lower));
  if (setKey) {
    fields.setName = POKEMON_SETS[setKey];
    fc.setName = base + 0.15;
    rest = lower.replace(new RegExp(`(^|\\s)${setKey}(\\s|$)`), " ");
  } else {
    // "Topps Chrome", "Panini Prizm": keep every product word, in the order written.
    const found = [...SPORTS_BRANDS]
      .sort((a, b) => b.length - a.length)
      .map((b) => ({ b, at: lower.search(new RegExp(`(^|\\s)${b}(\\s|$)`)) }))
      .filter((x) => x.at >= 0)
      .sort((x, y) => x.at - y.at);
    if (found.length) {
      fields.setName = titleCase(found.map((x) => x.b).join(" "));
      fc.setName = base;
      rest = lower;
      for (const { b } of found) rest = rest.replace(new RegExp(`(^|\\s)${b}(\\s|$)`), " ");
    }
  }

  const game = detectGame(text);
  fields.game = game.game;
  fc.game = game.confidence;

  const words = rest
    .replace(/[\-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !NOISE_RE.test(w) && !/^\d+$/.test(w))
    .filter((w) => !["pokemon", "pokémon", "mtg", "magic", "card", "tcg", "bulk", "lot", "common", "uncommon"].includes(w.toLowerCase()));
  if (words.length && words.join("").length >= 4) {
    const name = titleCase(words.join(" "));
    if (game.game === "Sports") {
      fields.player = name;
      fc.player = base;
    }
    fields.name = name;
    fc.name = base;
  }

  const bulkHint = /\b(bulk|commons?|uncommons?|energy|junk|filler)\b/i.test(text);
  const vals = Object.values(fc).filter((v): v is number => typeof v === "number");
  const filled = ["name", "setName", "number"].filter((k) => fields[k as keyof CardFields]).length;
  const confidence = vals.length ? Math.min(base + 0.1, (filled / 3) * base + 0.05) : 0;
  return { fields, fieldConfidence: fc, confidence: Math.max(0, Math.round(confidence * 100) / 100), bulkHint };
}
