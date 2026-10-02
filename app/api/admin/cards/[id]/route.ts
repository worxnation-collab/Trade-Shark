import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { applySuggestion, priceCard, relinkCatalog } from "@/lib/pipeline";
import { getSettings } from "@/lib/settings";
import { CONDITIONS, GAMES, PILES, SHIPPING_PROFILES, STATUSES } from "@/lib/types";

export const runtime = "nodejs";

const TEXT = ["name", "setName", "setCode", "number", "year", "variant", "rarity", "player", "team", "graded", "notes", "title", "description", "listedUrl", "soldChannel"] as const;
const IDENTITY = ["game", "name", "setName", "setCode", "number", "year", "variant", "player"] as const;

interface Body {
  [k: string]: unknown;
  confirm?: boolean;
  alternate?: { source: string; catalogId?: string; catalogImage?: string; tcgplayerId?: string; tcgplayerUrl?: string };
}

const numOrNull = (v: unknown) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export const PATCH = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json()) as Body;
  const s = await getSettings();
  const before = await db.card.findUniqueOrThrow({ where: { id } });
  const data: Prisma.CardUpdateInput = {};

  for (const k of TEXT) if (k in b) (data as Record<string, unknown>)[k] = typeof b[k] === "string" && (b[k] as string).trim() ? (b[k] as string).trim() : null;
  if (typeof b.game === "string" && (GAMES as readonly string[]).includes(b.game)) data.game = b.game;
  if (typeof b.condition === "string" && (CONDITIONS as readonly string[]).includes(b.condition)) data.condition = b.condition;
  if (typeof b.shippingProfile === "string" && (SHIPPING_PROFILES as readonly string[]).includes(b.shippingProfile)) data.shippingProfile = b.shippingProfile;
  if (typeof b.pile === "string" && (PILES as readonly string[]).includes(b.pile)) data.pile = b.pile;
  if (typeof b.listedChannel === "string") data.listedChannel = b.listedChannel || null;
  if ("quantity" in b) data.quantity = Math.max(1, Math.floor(Number(b.quantity) || 1));
  if ("cost" in b) data.cost = numOrNull(b.cost);
  if ("manualPrice" in b) data.manualPrice = numOrNull(b.manualPrice);
  if ("soldPrice" in b) data.soldPrice = numOrNull(b.soldPrice);
  if ("pastedComps" in b) data.pastedComps = typeof b.pastedComps === "string" && b.pastedComps.trim() ? b.pastedComps : null;

  const identityChanged = IDENTITY.some((k) => k in data && (data as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k]);
  if (b.alternate) {
    data.identSource = b.alternate.source;
    data.catalogId = b.alternate.catalogId ?? null;
    data.catalogImage = b.alternate.catalogImage ?? null;
    data.tcgplayerId = b.alternate.tcgplayerId ?? null;
    data.tcgplayerUrl = b.alternate.tcgplayerUrl ?? null;
  }
  if (b.confirm) {
    data.confirmedAt = new Date();
    data.sourceConfidence = 1;
  }

  let card = await db.card.update({ where: { id }, data });

  // Manual price is a quote too, so the history shows it.
  if ("manualPrice" in b && card.manualPrice != null && card.manualPrice !== before.manualPrice) {
    await db.priceQuote.create({ data: { cardId: id, source: "manual", kind: "manual", label: "manual", amount: card.manualPrice, rawTitle: "Manual override" } });
  }
  if ("pastedComps" in b && card.pastedComps !== before.pastedComps) {
    await db.priceQuote.updateMany({ where: { cardId: id, source: "pasted", excluded: false }, data: { excluded: true, excludeReason: "replaced by a newer paste" } });
  }

  if (!b.alternate && identityChanged) card = await relinkCatalog(card);
  if (b.alternate || identityChanged) card = await priceCard(card, s);
  else if ("pastedComps" in b && card.pastedComps !== before.pastedComps) card = await priceCard(card, s, { sources: ["pasted"] });
  else card = await applySuggestion(id, s);

  // Status moves only from my hand.
  let status = card.status;
  if (typeof b.status === "string" && (STATUSES as readonly string[]).includes(b.status)) status = b.status;
  // An unreadable file has no photo to sell; it can be confirmed but stays out of Ready.
  else if (b.confirm && card.readable && ["Inbox", "Identified", "Priced", "BulkHold"].includes(card.status)) {
    status = card.listPrice == null ? "Identified" : card.listPrice < s.minListPrice ? "BulkHold" : "Ready";
  }
  const extra: Prisma.CardUpdateInput = {};
  if (card.listedUrl && card.listedUrl !== before.listedUrl && ["Ready", "Priced"].includes(status)) status = "Listed";
  if (status === "Listed" && !card.listedAt) extra.listedAt = new Date();
  if (card.soldPrice != null && before.soldPrice == null && status !== "Sold") status = "Sold";
  if (status === "Sold" && !card.soldAt) extra.soldAt = new Date();
  card = await db.card.update({ where: { id }, data: { status, ...extra } });
  return NextResponse.json({ ok: true, card });
});

export const DELETE = guarded(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await db.card.update({ where: { id }, data: { status: "Archived" } });
  return NextResponse.json({ ok: true });
});
