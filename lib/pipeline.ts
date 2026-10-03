import type { Card } from "@prisma/client";
import { db } from "./db";
import { mergeCandidates } from "./identify/merge";
import { hamming, storeUpload } from "./images";
import { matchManifest, parseManifest } from "./organize/manifest";
import { pairFiles, type BackDecision, type PairMode } from "./organize/pairing";
import { parseText } from "./organize/parse";
import { buildLilStacks, releaseFromPack } from "./lilStack";
import { orientCard } from "./orient";
import { autoPublish, publishLeftovers } from "./publish";
import { shopPrice, statusAfterPricing, suggest, type QuoteRow } from "./pricing/engine";
import { getSettings, type Settings } from "./settings";
import { appliesTo, CATALOG_SOURCES, PRICE_SOURCES, VISION_SOURCES } from "./sources";
import type { RunStatus } from "./sources/types";
import type { CardFields, Game, IdentCandidate, IdentField, Pile } from "./types";
import { limiter, norm, normNumber, safeJson } from "./util";
import { newestYear, recomputeBatchWow, wowData } from "./wow";

/* ------------------------------------------------------------------ ingest */

/** Flatbed metadata that rides along with a crop (or marks the original sheet). */
export interface SheetMeta {
  kind?: "sheet" | "crop";
  pairKey?: string;
  side?: "front" | "back";
  sheetName?: string;
  sheetRel?: string;
  sheetHash?: string;
  cropIndex?: number;
  cropBox?: unknown;
}

/** Phase 1: store files as they stream in (chunked uploads). Original flatbed sheets are kept but never become cards. */
export async function storeBatchFiles(batchId: string, files: { name: string; buf: Uint8Array; rel?: string; meta?: SheetMeta }[]) {
  const out = [];
  for (const f of files) {
    const st = await storeUpload(batchId, f.buf, f.rel);
    const m = f.meta ?? {};
    out.push(
      await db.uploadFile.create({
        data: {
          batchId,
          name: f.name,
          rel: st.rel,
          hash: st.hash,
          phash: st.phash,
          mime: st.mime,
          size: f.buf.byteLength,
          readable: st.readable,
          side: m.kind === "sheet" ? "sheet" : m.side,
          pairKey: m.kind === "sheet" ? null : m.pairKey,
          sheetName: m.sheetName,
          sheetRel: m.sheetRel,
          sheetHash: m.sheetHash,
          cropIndex: m.cropIndex,
          cropBox: m.cropBox ? JSON.stringify(m.cropBox) : null,
        },
      }),
    );
  }
  return out;
}

export interface OrganizeInput {
  pairMode: PairMode;
  manifest?: string;
  pastedLines?: string;
}

const PHASH_NEAR = 20; // of 256 bits (~8%): "same card, rescanned or recompressed"; different cards land ~60-130

/** Phase 2: pair, dedupe, parse, and create cards for every not-yet-organized file in the batch. */
export async function organizeBatch(batchId: string, input: OrganizeInput) {
  await db.batch.update({ where: { id: batchId }, data: { pairMode: input.pairMode } });
  const stored = await db.uploadFile.findMany({
    where: { batchId, cardId: null, OR: [{ side: null }, { side: { not: "sheet" } }] },
    orderBy: { name: "asc" },
  });

  // Backs already in inventory teach Auto what a back looks like, even for a one-card batch.
  const knownBacks = (
    await db.card.findMany({ where: { backPhash: { not: null } }, select: { backPhash: true }, orderBy: { createdAt: "desc" }, take: 3000 })
  ).map((c) => c.backPhash!);
  let decision: BackDecision | undefined;
  const groups = pairFiles(stored, input.pairMode, { knownBacks, onDecision: (d) => (decision = d) });
  if (decision) await db.batch.update({ where: { id: batchId }, data: { pairDecision: JSON.stringify(decision) } });
  const manifest = input.manifest ? parseManifest(input.manifest) : [];
  const lines = (input.pastedLines ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Existing inventory for dedupe (personal-scale: load hashes into memory).
  const existing = await db.card.findMany({
    select: { id: true, frontHash: true, frontPhash: true },
  });
  const seenHash = new Map<string, string>();
  const seenPhash: { ph: string; id: string }[] = [];
  for (const c of existing) {
    if (c.frontHash) seenHash.set(c.frontHash, c.id);
    // Near-dup only on fronts: every Pokemon/Magic back looks the same.
    if (c.frontPhash) seenPhash.push({ ph: c.frontPhash, id: c.id });
  }
  const already = await db.card.count({ where: { batchId } });
  const created: string[] = [];
  let position = 0;
  for (const g of groups) {
    const front = g.front;
    const back = g.back;
    const seeds: IdentCandidate[] = [];
    let bulkHint = false;

    if (front) {
      const p = parseText(front.name, { isFilename: true });
      bulkHint ||= p.bulkHint;
      if (p.fields.name || p.fields.number || p.fields.setName)
        seeds.push({ source: "filename", confidence: p.confidence, fields: p.fields, fieldConfidence: p.fieldConfidence });
    }
    const row = g.pile !== "unreadable" ? matchManifest(manifest, front?.name, back?.name, position) : undefined;
    if (row && Object.keys(row.fields).length) {
      const fc: Partial<Record<IdentField, number>> = {};
      for (const k of Object.keys(row.fields)) fc[k as IdentField] = 0.85;
      if (!row.fields.game) {
        const p = parseText([row.fields.name, row.fields.setName, row.fields.variant].filter(Boolean).join(" "));
        row.fields.game = p.fields.game;
        fc.game = p.fieldConfidence.game;
      }
      seeds.push({ source: "manifest", confidence: row.fields.name && (row.fields.number || row.fields.setName) ? 0.85 : 0.6, fields: row.fields, fieldConfidence: fc });
      bulkHint ||= !!row.bulk;
    }
    const line = g.pile !== "unreadable" ? lines[position] : undefined;
    if (line) {
      const p = parseText(line);
      bulkHint ||= p.bulkHint;
      // A line I typed with a name and a number is deliberate: trust it over a disagreeing catalog guess.
      const conf = p.fields.name && p.fields.number ? 0.7 : Math.min(0.75, p.confidence + 0.1);
      seeds.push({ source: "pasted", confidence: conf, fields: p.fields, fieldConfidence: p.fieldConfidence, note: line });
    }
    if (g.pile !== "unreadable") position++;

    const m = mergeCandidates(seeds);

    // Dedupe on the front only (exact hash, then near-identical image): backs repeat across a game.
    let dupOf = front ? seenHash.get(front.hash) : undefined;
    if (!dupOf && front?.phash) dupOf = seenPhash.find((s) => hamming(s.ph, front.phash!) <= PHASH_NEAR)?.id;

    let pile: Pile = g.pile;
    if (pile !== "unreadable") {
      if (dupOf) pile = "duplicate";
      else if (pile === "none" && bulkHint) pile = "likely_bulk";
    }

    const card = await db.card.create({
      data: {
        batchId,
        pairId: `${batchId.slice(-6)}-${String(already + created.length + 1).padStart(4, "0")}`,
        pile,
        readable: g.pile !== "unreadable",
        sheetInfo:
          front?.sheetName || back?.sheetName
            ? JSON.stringify({
                front: front?.sheetName ? { sheet: front.sheetName, rel: front.sheetRel, index: front.cropIndex } : null,
                back: back?.sheetName ? { sheet: back.sheetName, rel: back.sheetRel, index: back.cropIndex } : null,
              })
            : null,
        game: m.fields.game ?? "Other",
        name: m.fields.name,
        setName: m.fields.setName,
        setCode: m.fields.setCode,
        number: m.fields.number,
        year: m.fields.year,
        variant: m.fields.variant,
        rarity: m.fields.rarity,
        player: m.fields.player,
        team: m.fields.team,
        condition: m.fields.condition ?? "NM",
        graded: m.fields.graded,
        cost: row?.cost,
        quantity: row?.quantity ?? 1,
        notes: row?.notes,
        frontImage: front?.rel,
        backImage: back?.rel,
        frontOrigName: front?.name,
        backOrigName: back?.name,
        frontHash: front?.hash,
        backHash: back?.hash,
        frontPhash: front?.phash,
        backPhash: back?.phash,
        duplicateOfId: dupOf,
        identSource: m.winner?.source,
        sourceConfidence: m.confidence,
        fieldConfidence: JSON.stringify(m.fieldConfidence),
        identAlternates: JSON.stringify(m.alternates),
        seedCandidates: JSON.stringify(seeds),
      },
    });
    created.push(card.id);
    await db.uploadFile.updateMany({ where: { id: { in: [front?.id, back?.id].filter(Boolean) as string[] } }, data: { cardId: card.id } });
    if (front && !seenHash.has(front.hash)) seenHash.set(front.hash, card.id);
    if (front?.phash) seenPhash.push({ ph: front.phash, id: card.id });
  }
  return { batchId, cards: created.length, files: stored.length, pairDecision: decision };
}

/* ---------------------------------------------------------------- identify */

async function recordRun(cardId: string, source: string, phase: "identify" | "price", status: RunStatus, reason: string | undefined, t0: number) {
  await db.sourceRun.create({ data: { cardId, source, phase, status, reason: reason?.slice(0, 500), durationMs: Date.now() - t0 } });
}

export async function identifyCard(card: Card, s: Settings) {
  if (card.confirmedAt || !card.readable) return card;
  const seeds = safeJson<IdentCandidate[]>(card.seedCandidates, []);
  const cands: IdentCandidate[] = [...seeds];

  // 1) Vision (first configured provider that answers)
  let visionDone = false;
  for (const a of VISION_SOURCES) {
    const t0 = Date.now();
    const cfg = a.configured();
    if (!cfg.ok) {
      await recordRun(card.id, a.id, "identify", "skipped", cfg.reason, t0);
      continue;
    }
    if (visionDone) {
      await recordRun(card.id, a.id, "identify", "skipped", "another vision provider already answered", t0);
      continue;
    }
    const r = await a.identify({
      cardId: card.id,
      game: card.game as Game,
      hints: {},
      frontImage: card.frontImage,
      backImage: card.backImage,
      frontHash: card.frontHash,
      backHash: card.backHash,
    });
    await recordRun(card.id, a.id, "identify", r.status, r.reason ?? r.data?.[0]?.note, t0);
    if (r.status === "ok" && r.data?.length) {
      cands.push(...r.data);
      visionDone = true;
    }
  }

  // 2) Catalogs, searched with the best guess so far
  const pre = mergeCandidates(cands);
  const hints: CardFields = { ...pre.fields };
  const game = (hints.game ?? card.game) as Game;
  for (const a of CATALOG_SOURCES) {
    const t0 = Date.now();
    if (!appliesTo(a, game)) {
      await recordRun(card.id, a.id, "identify", "skipped", `not used for ${game}`, t0);
      continue;
    }
    const cfg = a.configured();
    if (!cfg.ok) {
      await recordRun(card.id, a.id, "identify", "skipped", cfg.reason, t0);
      continue;
    }
    const r = await a.identify({ cardId: card.id, game, hints, frontImage: card.frontImage, backImage: card.backImage });
    await recordRun(card.id, a.id, "identify", r.status, r.reason, t0);
    if (r.status === "ok" && r.data) cands.push(...r.data);
  }

  const m = mergeCandidates(cands);
  const identOk = m.confidence >= s.confidenceThreshold;
  const w = m.winner;
  // A different (or no) catalog match means the old catalog prices describe some other card.
  if ((w?.catalogId ?? null) !== card.catalogId || !w?.catalogId) await retireCatalogQuotes(card.id);
  const f = m.fields;
  return db.card.update({
    where: { id: card.id },
    data: {
      game: f.game ?? card.game,
      name: f.name ?? card.name,
      setName: f.setName ?? card.setName,
      setCode: f.setCode ?? card.setCode,
      number: f.number ?? card.number,
      year: f.year ?? card.year,
      variant: f.variant ?? card.variant,
      rarity: f.rarity ?? card.rarity,
      player: f.player ?? card.player,
      team: f.team ?? card.team,
      condition: card.condition === "NM" && f.condition ? f.condition : card.condition,
      graded: card.graded ?? f.graded,
      identSource: w?.source ?? card.identSource,
      sourceConfidence: m.confidence,
      fieldConfidence: JSON.stringify(m.fieldConfidence),
      identAlternates: JSON.stringify(m.alternates),
      identConflict: m.conflict,
      catalogId: w?.catalogId ?? null,
      catalogImage: w?.catalogImage ?? null,
      tcgplayerId: w?.tcgplayerId ?? null,
      tcgplayerUrl: w?.tcgplayerUrl ?? null,
      status: card.status === "Inbox" && identOk ? "Identified" : card.status,
    },
  });
}

/** Exclude prices that came from a catalog match the card no longer has. */
export async function retireCatalogQuotes(cardId: string) {
  await db.priceQuote.updateMany({
    where: { cardId, source: { in: ["pokemontcg", "cardmarket", "scryfall"] }, excluded: false },
    data: { excluded: true, excludeReason: "catalog match changed" },
  });
}

/** Same name + set + number already in inventory → Duplicate pile for review (could be a second copy). */
export async function flagNameDuplicate(card: Card) {
  if (!card.name || !card.number || card.pile === "duplicate" || card.pile === "unreadable") return card;
  const others = await db.card.findMany({
    where: { id: { not: card.id }, name: card.name, status: { not: "Archived" } },
    select: { id: true, setName: true, number: true },
  });
  const hit = others.find((o) => norm(o.setName) === norm(card.setName) && normNumber(o.number) === normNumber(card.number));
  if (!hit) return card;
  return db.card.update({ where: { id: card.id }, data: { pile: "duplicate", duplicateOfId: hit.id } });
}

/* ------------------------------------------------------------------- price */

export async function priceCard(card: Card, s: Settings, opts: { onlyStale?: boolean; sources?: string[]; allowLivePriceChange?: boolean } = {}) {
  const game = card.game as Game;
  const staleMs = s.staleHours * 3600_000;
  const existing = await db.priceQuote.findMany({ where: { cardId: card.id } });
  const newest = (src: string[]) =>
    Math.max(0, ...existing.filter((q) => src.includes(q.source)).map((q) => q.fetchedAt.getTime()));

  for (const a of PRICE_SOURCES) {
    if (opts.sources && !opts.sources.includes(a.id)) continue;
    const t0 = Date.now();
    if (!appliesTo(a, game)) continue;
    const cfg = a.configured();
    if (!cfg.ok) {
      await recordRun(card.id, a.id, "price", "skipped", cfg.reason, t0);
      continue;
    }
    const srcIds = a.id === "ebay" ? ["ebay_sold", "ebay_active"] : a.id === "pokemontcg" ? ["pokemontcg", "cardmarket"] : [a.id];
    // Pasted comps are my data: parse once per paste (the card PATCH asks for it explicitly).
    if (a.id === "pasted" && !opts.sources?.includes("pasted") && newest(srcIds)) continue;
    if (opts.onlyStale) {
      const last = newest(srcIds);
      if (last && Date.now() - last < staleMs) continue;
    }
    const r = await a.price({
      cardId: card.id,
      game,
      fields: {
        name: card.name ?? undefined,
        setName: card.setName ?? undefined,
        setCode: card.setCode ?? undefined,
        number: card.number ?? undefined,
        year: card.year ?? undefined,
        variant: card.variant ?? undefined,
        player: card.player ?? undefined,
        graded: card.graded ?? undefined,
        game,
      },
      catalogId: card.catalogId,
      identSource: card.identSource,
      pastedComps: card.pastedComps,
    });
    const kept = r.data?.filter((q) => !q.excluded).length ?? 0;
    await recordRun(
      card.id,
      a.id,
      "price",
      r.status,
      r.reason ?? (r.data ? `${r.data.length} quote(s), ${kept} kept` : undefined),
      t0,
    );
    if (r.status === "ok" && r.data?.length) {
      const fetchedAt = new Date();
      await db.priceQuote.createMany({
        data: r.data.map((q) => ({
          cardId: card.id,
          source: q.source,
          kind: q.kind,
          label: q.label,
          amount: q.amount,
          currency: q.currency ?? "USD",
          condition: q.condition ?? null,
          rawTitle: q.rawTitle?.slice(0, 300),
          url: q.url,
          soldAt: q.soldAt,
          excluded: !!q.excluded,
          excludeReason: q.excludeReason,
          fetchedAt,
        })),
      });
    }
  }
  return applySuggestion(card.id, s, { allowLivePriceChange: opts.allowLivePriceChange });
}

/** Recompute suggestion + status from stored quotes (no network). */
export async function applySuggestion(cardId: string, s: Settings, opts: { allowLivePriceChange?: boolean } = {}) {
  const card = await db.card.findUniqueOrThrow({ where: { id: cardId } });
  const quotes = (await db.priceQuote.findMany({ where: { cardId } })) as QuoteRow[];
  const sug = suggest(quotes, card, s);
  const identOk = !!card.confirmedAt || card.sourceConfidence >= s.confidenceThreshold;
  // A live pay link fixes the price buyers see; only a manual save may change it (and regenerates the link).
  // Shop price: nearest dollar (min $1, $1 when no source), exact under $1 for Lil' Stack cards; manual wins.
  const raw = sug.basis === "manual" ? sug.basisAmount : sug.price;
  const listPrice = card.paymentLinkActive && !opts.allowLivePriceChange ? card.listPrice : shopPrice(raw, card.manualPrice);
  const status = statusAfterPricing(card.status, listPrice, identOk, s);
  // Repriced to $1 or more: out of its Lil' Stack and back on the normal path.
  if (card.status === "LilStack" && status !== "LilStack") await releaseFromPack(card);
  return db.card.update({
    where: { id: cardId },
    data: {
      suggestedPrice: raw != null ? shopPrice(raw) : null,
      suggestedSource: sug.basisLabel,
      priceConflict: sug.conflict,
      listPrice,
      pricedAt: new Date(),
      status,
      ...wowData(card, s, await newestYear(card.batchId)),
    },
  });
}

/* ------------------------------------------------------------------- batch */

export async function processBatch(batchId: string, limit = 6) {
  const s = await getSettings();
  // Step 1 for every card: stand it upright (its own request, so each call stays short).
  const unoriented = await db.card.findMany({
    where: { batchId, processedAt: null, orientedAt: null, readable: true, frontImage: { not: null } },
    orderBy: { pairId: "asc" },
    take: limit,
  });
  if (unoriented.length) {
    for (const c of unoriented) {
      try {
        await orientCard(c);
      } catch (e) {
        // Never block the batch on it: mark it so the card waits in Needs a look instead of publishing sideways.
        await db.card.update({ where: { id: c.id }, data: { orientedAt: new Date(), rotationNote: "unsure", holdReason: "rotation" } });
        await db.sourceRun.create({ data: { cardId: c.id, source: "orient", phase: "identify", status: "error", reason: (e instanceof Error ? e.message : String(e)).slice(0, 500) } });
      }
    }
    const remaining = await db.card.count({ where: { batchId, processedAt: null } });
    return { processed: unoriented.length, oriented: unoriented.length, remaining, decisions: [] as string[] };
  }
  const todo = await db.card.findMany({
    where: { batchId, processedAt: null },
    orderBy: { pairId: "asc" },
    take: limit,
  });
  const run = limiter(3);
  const decisions: string[] = [];
  await Promise.all(
    todo.map((c) =>
      run(async () => {
        try {
          if (c.readable) {
            let card = await identifyCard(c, s);
            card = await flagNameDuplicate(card);
            card = await priceCard(card, s);
            // Straight to the shop: publish $5 and under, flag over $5, stack under $1, hold the unnamed.
            decisions.push(await autoPublish(card, s));
          } else decisions.push("hold");
        } catch (e) {
          await db.sourceRun.create({
            data: { cardId: c.id, source: "pipeline", phase: "identify", status: "error", reason: e instanceof Error ? e.message : String(e) },
          });
        } finally {
          await db.card.update({ where: { id: c.id }, data: { processedAt: new Date() } });
        }
      }),
    ),
  );
  const remaining = await db.card.count({ where: { batchId, processedAt: null } });
  if (todo.length && !remaining) await recomputeBatchWow(batchId, s);
  // The batch is identified and priced: pile every sub-$1 card into Lil' Stacks.
  const lilStack = todo.length && !remaining ? await buildLilStacks(batchId).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })) : undefined;
  if (todo.length && !remaining) await publishLeftovers(batchId, s).catch(() => 0);
  return { processed: todo.length, remaining, decisions, lilStack };
}

/** Refresh quotes older than staleHours for every card in a batch (chunked like processBatch). */
export async function repriceBatch(batchId: string, cursor = 0, limit = 2) {
  const s = await getSettings();
  const cards = await db.card.findMany({
    where: { batchId, readable: true, status: { notIn: ["Sold", "Archived"] } },
    orderBy: { pairId: "asc" },
    skip: cursor,
    take: limit,
  });
  const run = limiter(3);
  await Promise.all(cards.map((c) => run(() => priceCard(c, s, { onlyStale: true }))));
  const total = await db.card.count({ where: { batchId, readable: true, status: { notIn: ["Sold", "Archived"] } } });
  const next = cursor + cards.length;
  if (next >= total) {
    await recomputeBatchWow(batchId, s);
    await publishLeftovers(batchId, s).catch(() => 0);
  }
  return { next, total, done: next >= total };
}

/**
 * After I edit identity by hand, find the catalog entry that matches what I typed (exact name + number)
 * so catalog price sources can run. Never changes the fields I typed.
 */
export async function relinkCatalog(card: Card) {
  const game = card.game as Game;
  const hints: CardFields = {
    name: card.name ?? undefined,
    setName: card.setName ?? undefined,
    setCode: card.setCode ?? undefined,
    number: card.number ?? undefined,
    year: card.year ?? undefined,
  };
  for (const a of CATALOG_SOURCES) {
    if (!appliesTo(a, game) || game === "Other" || !a.configured().ok) continue;
    const t0 = Date.now();
    const r = await a.identify({ cardId: card.id, game, hints });
    await recordRun(card.id, a.id, "identify", r.status, r.reason ?? "relink after manual edit", t0);
    const best = r.data?.find(
      (c) => norm(c.fields.name) === norm(card.name) && (!card.number || normNumber(c.fields.number) === normNumber(card.number)),
    );
    if (best && best.catalogId !== card.catalogId) await retireCatalogQuotes(card.id);
    if (best)
      return db.card.update({
        where: { id: card.id },
        data: { catalogId: best.catalogId, catalogImage: best.catalogImage, tcgplayerId: best.tcgplayerId ?? null, tcgplayerUrl: best.tcgplayerUrl ?? null, identSource: "manual" },
      });
  }
  if (card.catalogId) await retireCatalogQuotes(card.id);
  return db.card.update({ where: { id: card.id }, data: { catalogId: null, catalogImage: null, identSource: "manual" } });
}
