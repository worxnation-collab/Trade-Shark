import type { CardFields } from "../types";
import { median, norm, normNumber } from "../util";

export interface Comp {
  title: string;
  amount: number;
  currency: string;
  soldAt?: Date;
  url?: string;
  excluded?: boolean;
  excludeReason?: string;
}

const PRICE_RE = /(?:US\s?)?\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;
const NOISE_RE = /shipping|delivery|postage|\bfree returns?\b|\bsponsored\b|\bshop on ebay\b|\bwatchers?\b|\bbids?\b$/i;
const DATE_RE = /\b(?:sold|ended)\s+([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})/i;

/**
 * Parse a block copied from an eBay "Sold items" search (or any "title ... $price" list).
 * Handles both "title on one line, price on the next" and "title - $12.50" on one line.
 */
export function parsePastedComps(text: string): Comp[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const comps: Comp[] = [];
  let lastTitle = "";
  let lastDate: Date | undefined;
  for (const line of lines) {
    const d = line.match(DATE_RE);
    if (d) {
      const dt = new Date(d[1].replace(".", ""));
      if (!Number.isNaN(dt.getTime())) lastDate = dt;
      if (line.replace(DATE_RE, "").trim().length < 4) continue;
    }
    const p = line.match(PRICE_RE);
    const isNoise = NOISE_RE.test(line) || /^\+/.test(line);
    if (p && !isNoise) {
      if (/\bto\s+\$/i.test(line)) continue; // price ranges are active listings with variations
      const amount = Number(p[1].replace(/,/g, ""));
      const rest = line.replace(PRICE_RE, "").replace(/^[\s\-–|:]+|[\s\-–|:]+$/g, "").replace(DATE_RE, "").trim();
      const title = rest.replace(/[^a-z]/gi, "").length >= 8 ? rest : lastTitle;
      if (amount > 0 && title) {
        comps.push({ title, amount, currency: "USD", soldAt: lastDate });
        lastTitle = "";
        lastDate = undefined;
      }
      continue;
    }
    if (!isNoise && line.replace(/[^a-z]/gi, "").length >= 8 && !/^(new listing|pre-owned|brand new|ungraded|graded)$/i.test(line)) {
      lastTitle = line.replace(/^new listing\s*/i, "");
    }
  }
  return comps;
}

const JUNK: [RegExp, string][] = [
  [/\blot\b|\blots\b|\bbundle\b|\bcollection\b|\bx\d+\b|\b\d+\s?x\b/i, "lot/bundle"],
  [/\bproxy\b|\bcustom\b|\breprint\b|\bfan ?art\b|\borica\b|\bfake\b|\breplica\b|\bmetal card\b|\bgold card\b/i, "proxy/custom/reprint"],
  [/\bdigital\b|\bcode card\b|\bonline code\b|\bptcgl?o?\b/i, "digital/code"],
  [/\byou pick\b|\bpick your\b|\bchoose\b|\bselect your\b|\bmystery\b|\brepack\b/i, "pick-your/mystery"],
  [/\bbooster\b|\bsealed\b|\bbox\b|\betb\b|\bpack\b|\bcase\b|\bbinder\b|\bsleeves?\b|\bempty\b/i, "sealed/product/accessory"],
  [/\bjapanese\b|\bjpn\b|\bkorean\b|\bchinese\b|\bgerman\b|\bfrench\b|\bitalian\b|\bspanish\b/i, "foreign language"],
];
const GRADED_RE = /\b(psa|bgs|cgc|sgc|tag|beckett)\s?(\d{1,2}(?:\.5)?)\b/i;

/**
 * Keep junk out of the median. Marks comps excluded with a reason rather than deleting them,
 * so the price panel can show what was thrown out and why.
 */
export function filterComps(comps: Comp[], card: CardFields): Comp[] {
  const nameTokens = norm(card.player || card.name)
    .split(" ")
    .filter((t) => t.length > 2 && !["the", "and", "holo", "rookie"].includes(t));
  const myNum = card.number ? normNumber(card.number) : "";
  const cardGrade = card.graded?.match(GRADED_RE);
  const wantsForeign = /japanese|korean|chinese/i.test(card.variant ?? "");
  const out = comps.map((c) => {
    const t = c.title;
    for (const [re, why] of JUNK) {
      if (why === "foreign language" && wantsForeign) continue;
      if (re.test(t)) return { ...c, excluded: true, excludeReason: why };
    }
    const g = t.match(GRADED_RE);
    if (!cardGrade && g) return { ...c, excluded: true, excludeReason: `graded comp (${g[0]}) vs raw card` };
    if (cardGrade && !g) return { ...c, excluded: true, excludeReason: "raw comp vs graded card" };
    if (cardGrade && g && (g[1].toLowerCase() !== cardGrade[1].toLowerCase() || g[2] !== cardGrade[2]))
      return { ...c, excluded: true, excludeReason: `different grade (${g[0]})` };
    const tn = norm(t);
    if (nameTokens.length && !nameTokens.some((tok) => tn.includes(tok)))
      return { ...c, excluded: true, excludeReason: "title doesn't mention the card name" };
    if (myNum && /^\d+$/.test(myNum)) {
      const nums = [...t.matchAll(/(?:#|\b)(\d{1,4})\s?\/\s?\d{1,4}\b/g)].map((m) => String(parseInt(m[1], 10)));
      if (nums.length && !nums.includes(myNum)) return { ...c, excluded: true, excludeReason: `different number (#${nums[0]})` };
    }
    return { ...c };
  });
  const kept = out.filter((c) => !c.excluded);
  if (kept.length >= 4) {
    const m = median(kept.map((c) => c.amount))!;
    for (const c of kept) {
      if (c.amount < m / 2.5 || c.amount > m * 2.5) {
        c.excluded = true;
        c.excludeReason = `outlier vs median $${m.toFixed(2)}`;
      }
    }
  }
  return out;
}

/** Comps are NM only if every kept title says so; otherwise condition is unknown. */
export function compsAreNM(comps: Comp[]) {
  const kept = comps.filter((c) => !c.excluded);
  return kept.length > 0 && kept.every((c) => /\b(nm|near mint|nm-?mt|mint)\b/i.test(c.title));
}

export function compSearchQuery(f: CardFields) {
  const num = f.number?.split("/")[0];
  return [f.year, f.setName, f.player || f.name, num && `#${num}`, f.variant, f.graded]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
