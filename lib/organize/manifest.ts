import type { CardFields, Condition, Game } from "../types";
import { CONDITIONS, GAMES } from "../types";
import { stemOf } from "./parse";

/** Minimal RFC4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export interface ManifestRow {
  file?: string; // front filename, or generic filename
  back?: string;
  fields: CardFields;
  cost?: number;
  quantity?: number;
  notes?: string;
  bulk?: boolean;
}

const ALIASES: Record<string, string[]> = {
  file: ["file", "filename", "front", "front_file", "image", "front image", "front_filename"],
  back: ["back", "back_file", "back image", "back_filename"],
  name: ["name", "card", "card name", "title", "product name"],
  setName: ["set", "set name", "setname", "series", "product"],
  setCode: ["set code", "setcode", "code"],
  number: ["number", "no", "#", "card number", "collector number", "num"],
  year: ["year"],
  variant: ["variant", "parallel", "finish", "printing"],
  rarity: ["rarity"],
  player: ["player"],
  team: ["team"],
  game: ["game", "category", "type"],
  condition: ["condition", "cond"],
  graded: ["grade", "graded"],
  cost: ["cost", "paid", "cost basis", "price paid"],
  quantity: ["qty", "quantity", "count"],
  notes: ["notes", "note", "comments"],
  bulk: ["bulk"],
};

function headerIndex(header: string[]) {
  const h = header.map((x) => x.trim().toLowerCase().replace(/[_\-]+/g, " "));
  const idx: Record<string, number> = {};
  for (const [k, names] of Object.entries(ALIASES)) {
    const i = h.findIndex((x) => names.map((n) => n.replace(/[_\-]+/g, " ")).includes(x));
    if (i >= 0) idx[k] = i;
  }
  return idx;
}

function asGame(s: string): Game | undefined {
  const t = s.trim().toLowerCase();
  if (!t) return undefined;
  if (/poke/.test(t)) return "Pokemon";
  if (/mtg|magic/.test(t)) return "Magic";
  if (/sport|baseball|football|basketball|hockey|soccer/.test(t)) return "Sports";
  return GAMES.find((g) => g.toLowerCase() === t) ?? "Other";
}

function asCondition(s: string): Condition | undefined {
  const t = s.trim().toUpperCase().replace(/\s+/g, "");
  if (!t) return undefined;
  const map: Record<string, Condition> = {
    NEARMINT: "NM", NM: "NM", M: "NM", MINT: "NM", LIGHTLYPLAYED: "LP", LP: "LP", EX: "LP", EXCELLENT: "LP",
    MODERATELYPLAYED: "MP", MP: "MP", HEAVILYPLAYED: "HP", HP: "HP", DAMAGED: "DMG", DMG: "DMG", POOR: "DMG",
  };
  return map[t] ?? (CONDITIONS as readonly string[]).find((c) => c === t) as Condition | undefined;
}

export function parseManifest(text: string): ManifestRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const idx = headerIndex(rows[0]);
  const get = (r: string[], k: string) => (idx[k] != null ? (r[idx[k]] ?? "").trim() : "");
  return rows.slice(1).map((r) => {
    const num = (k: string) => {
      const v = get(r, k).replace(/[$,]/g, "");
      return v && !Number.isNaN(Number(v)) ? Number(v) : undefined;
    };
    const fields: CardFields = {};
    for (const k of ["name", "setName", "setCode", "number", "year", "variant", "rarity", "player", "team", "graded"] as const) {
      const v = get(r, k);
      if (v) fields[k] = v;
    }
    const g = asGame(get(r, "game"));
    if (g) fields.game = g;
    const c = asCondition(get(r, "condition"));
    if (c) fields.condition = c;
    return {
      file: get(r, "file") || undefined,
      back: get(r, "back") || undefined,
      fields,
      cost: num("cost"),
      quantity: num("quantity"),
      notes: get(r, "notes") || undefined,
      bulk: /^(y|yes|true|1|bulk)$/i.test(get(r, "bulk")),
    };
  });
}

/** Find the manifest row for a pair: by front/back filename stem, else by position. */
export function matchManifest(rows: ManifestRow[], frontName: string | undefined, backName: string | undefined, position: number) {
  const stems = [frontName, backName].filter(Boolean).map((n) => stemOf(n!).toLowerCase());
  const byName = rows.find((r) =>
    [r.file, r.back].filter(Boolean).some((f) => stems.includes(stemOf(f!).toLowerCase())),
  );
  if (byName) return byName;
  const anyNamed = rows.some((r) => r.file);
  return anyNamed ? undefined : rows[position];
}
