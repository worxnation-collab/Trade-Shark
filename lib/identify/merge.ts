import type { CardFields, IdentCandidate, IdentField } from "../types";
import { IDENT_FIELDS } from "../types";
import { norm, normNumber } from "../util";

/**
 * Merge candidates from all sources into one winner + alternates.
 * - A catalog match (Pokemon TCG / Scryfall) that agrees with an independent read (vision, manifest,
 *   pasted line, filename) is boosted; disagreement is flagged as a conflict.
 * - Field confidence is kept per field so the review form can highlight the shaky ones.
 */
export interface MergeResult {
  winner: IdentCandidate | null;
  fields: CardFields;
  fieldConfidence: Partial<Record<IdentField, number>>;
  confidence: number;
  alternates: IdentCandidate[];
  conflict: boolean;
}

/** Reads at or above this beat a disagreeing catalog match (filename guesses sit below it). */
const TRUSTED_READ = 0.6;

const CATALOG = new Set(["pokemontcg", "scryfall", "sports_catalog"]);
const READS = (c: IdentCandidate) => !CATALOG.has(c.source);

function agrees(a: CardFields, b: CardFields) {
  const nameOk = !!a.name && !!b.name && (norm(a.name) === norm(b.name) || norm(a.name).includes(norm(b.name)) || norm(b.name).includes(norm(a.name)));
  const ta = a.number?.split("/")[1]?.trim();
  const tb = b.number?.split("/")[1]?.trim();
  const totalOk = !ta || !tb || Number(ta) === Number(tb);
  const numOk = (!a.number || !b.number || normNumber(a.number) === normNumber(b.number)) && totalOk;
  return nameOk && numOk;
}

export function mergeCandidates(cands: IdentCandidate[]): MergeResult {
  const sorted = [...cands].sort((a, b) => b.confidence - a.confidence);
  if (!sorted.length) return { winner: null, fields: {}, fieldConfidence: {}, confidence: 0, alternates: [], conflict: false };

  const reads = sorted.filter(READS);
  const catalogs = sorted.filter((c) => !READS(c));
  let winner = sorted[0];
  let confidence = winner.confidence;
  let conflict = false;

  const topCatalog = catalogs[0];
  if (topCatalog) {
    const support = reads.filter((r) => agrees(r.fields, topCatalog.fields));
    if (support.length) {
      // Independent agreement: catalog fields win, confidence rises.
      winner = topCatalog;
      const best = Math.max(...support.map((s) => s.confidence));
      confidence = Math.min(0.97, Math.max(topCatalog.confidence, 1 - (1 - topCatalog.confidence) * (1 - best)));
    } else {
      // A confident read (pasted line, manifest, vision) that disagrees beats the catalog's guess:
      // the card in hand is often a printing the catalog doesn't carry (other language, promo).
      const strongRead = reads.find((r) => r.fields.name && r.confidence >= TRUSTED_READ);
      if (strongRead) {
        winner = strongRead;
        confidence = strongRead.confidence;
      } else if (topCatalog.confidence >= (reads[0]?.confidence ?? 0)) {
        winner = topCatalog;
        confidence = topCatalog.confidence;
      } else if (reads[0]) {
        winner = reads[0];
        confidence = reads[0].confidence;
      }
      if (reads.some((r) => r.fields.name && r.confidence >= 0.5)) conflict = true;
    }
  }

  // Start from the winner, fill blanks from others (reads can add variant/condition/player/team).
  const fields: CardFields = { ...winner.fields };
  const fc: Partial<Record<IdentField, number>> = { ...(winner.fieldConfidence ?? {}) };
  for (const k of IDENT_FIELDS) {
    if (fields[k] != null && fc[k] == null) fc[k] = winner.confidence;
    if (fields[k] != null) {
      // Boost a field when a second source independently says the same thing.
      const same = sorted.filter((c) => c !== winner && c.fields[k] && norm(String(c.fields[k])) === norm(String(fields[k])));
      if (same.length) fc[k] = Math.min(0.97, Math.max(fc[k] ?? 0, confidence));
      continue;
    }
    // Only borrow from sources that agree with the winner (a rejected catalog guess must not leak its set).
    const donor = sorted.find((c) => c.fields[k] && (READS(c) || c === winner || agrees(c.fields, winner.fields)));
    if (donor) {
      (fields as Record<string, unknown>)[k] = donor.fields[k];
      fc[k] = Math.min(donor.fieldConfidence?.[k] ?? donor.confidence, 0.75);
    }
  }
  for (const k of ["condition", "graded"] as const) {
    if (!fields[k]) {
      // Only borrow from sources that agree with the winner (a rejected catalog guess must not leak its set).
    const donor = sorted.find((c) => c.fields[k] && (READS(c) || c === winner || agrees(c.fields, winner.fields)));
      if (donor) fields[k] = donor.fields[k] as never;
    }
  }
  // Catalog-matched name/number/set get the merged confidence.
  // A field the catalog match didn't agree on (e.g. number mismatch) stays low so it gets highlighted.
  if (!READS(winner))
    for (const k of ["name", "number", "setName", "setCode"] as const) {
      if (!fields[k]) continue;
      const agreement = winner.fieldConfidence?.[k] ?? 1;
      fc[k] = agreement >= 0.75 ? confidence : Math.min(confidence, agreement);
    }

  // Sports: the "name" a manifest or filename gives is the player.
  if (fields.game === "Sports" && fields.name && !fields.player) {
    fields.player = fields.name;
    fc.player = fc.name;
  }

  return {
    winner,
    fields,
    fieldConfidence: fc,
    confidence: Math.round(confidence * 100) / 100,
    alternates: sorted.filter((c) => c !== winner).slice(0, 8),
    conflict,
  };
}
