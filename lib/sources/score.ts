import type { CardFields } from "../types";
import { norm, normNumber } from "../util";

/** Score a catalog candidate against what we already believe. Returns 0..1 plus per-field agreement. */
export function scoreCandidate(
  hints: CardFields,
  cand: { name: string; number?: string; setName?: string; setCode?: string; printedTotal?: number; year?: string },
) {
  const hn = norm(hints.name);
  const cn = norm(cand.name);
  let name = 0;
  if (hn && cn) {
    if (hn === cn) name = 1;
    else if (cn.includes(hn) || hn.includes(cn)) name = 0.75;
    else {
      const ht = new Set(hn.split(" "));
      const overlap = cn.split(" ").filter((t) => ht.has(t)).length / Math.max(1, cn.split(" ").length);
      name = overlap * 0.6;
    }
  }
  let number = 0.5;
  if (hints.number && cand.number) number = normNumber(hints.number) === normNumber(cand.number) ? 1 : 0;
  let set = 0.5;
  const hs = norm(hints.setName);
  const hc = norm(hints.setCode);
  if (hs || hc) {
    const cs = norm(cand.setName);
    const cc = norm(cand.setCode);
    set = (hs && cs && (hs === cs || cs.includes(hs) || hs.includes(cs))) || (hc && cc && hc === cc) ? 1 : 0.15;
  }
  // "4/102" also tells us the set size. A different size means a different printing (often another
  // language: Chinese 151 is /151, English 151 is /165), so it must not score as a match.
  const total = hints.number?.split("/")[1]?.trim();
  if (total && cand.printedTotal && /^\d+$/.test(total)) {
    if (Number(total) === cand.printedTotal) set = Math.max(set, 0.9);
    else {
      set = 0.05;
      number = Math.min(number, 0.4);
    }
  }
  let year = 0.5;
  if (hints.year && cand.year) year = hints.year === cand.year ? 1 : 0.3;
  const score = 0.5 * name + 0.25 * number + 0.17 * set + 0.08 * year;
  return { score, name, number, set };
}

/** Turn ranked raw scores into confidences; ties at the top cost confidence. */
export function calibrate(scores: number[]) {
  return scores.map((s, i) => {
    let c = s;
    if (i === 0 && scores[1] != null && scores[1] >= s - 0.02) c *= 0.85;
    return Math.min(0.97, Math.round(c * 100) / 100);
  });
}
