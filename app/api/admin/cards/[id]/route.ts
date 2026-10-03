import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { applySuggestion, priceCard, relinkCatalog } from "@/lib/pipeline";
import { getSettings } from "@/lib/settings";
import { LIL_STACK_UNDER, releaseFromPack } from "@/lib/lilStack";
import { issuePaymentLink, needsLink, retirePaymentLink } from "@/lib/payLink";
import { CONDITIONS, FOR_SALE, GAMES, PILES, SHIPPING_PROFILES, STATUSES } from "@/lib/types";

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
  if (b.alternate || identityChanged) card = await priceCard(card, s, { allowLivePriceChange: true });
  else if ("pastedComps" in b && card.pastedComps !== before.pastedComps) card = await priceCard(card, s, { sources: ["pasted"], allowLivePriceChange: true });
  else card = await applySuggestion(id, s, { allowLivePriceChange: true });

  // Status moves only from my hand.
  let status = card.status;
  // LilStack is only set by packing (a card needs a pack to be in one).
  if (typeof b.status === "string" && (STATUSES as readonly string[]).includes(b.status) && (b.status !== "LilStack" || card.lilStackId)) status = b.status;
  // An unreadable file has no photo to sell; it can be confirmed but stays out of Ready.
  // Saving a card I'm looking at approves it: $1+ goes live (pay link first), under $1 joins a Lil' Stack.
  else if (b.confirm && card.readable && ["Inbox", "Identified", "Priced", "BulkHold", "NeedsLook", "Pulled"].includes(card.status)) {
    status = card.listPrice == null ? "Identified" : card.listPrice < LIL_STACK_UNDER ? "BulkHold" : "Ready";
  }
  const extra: Prisma.CardUpdateInput = {};
  if (card.listedUrl && card.listedUrl !== before.listedUrl && ["Ready", "Priced"].includes(status)) status = "Listed";
  if (card.soldPrice != null && before.soldPrice == null && status !== "Sold") status = "Sold";

  // Under $1 never sells as a single: it belongs in a Lil' Stack.
  let linkError: string | undefined;
  if (FOR_SALE.includes(status as never) && card.listPrice != null && card.listPrice < LIL_STACK_UNDER) {
    linkError = `Under $${LIL_STACK_UNDER.toFixed(2)} goes in a Lil' Stack, not the shop. Price it at $${LIL_STACK_UNDER.toFixed(2)}+ to sell it as a single.`;
    status = before.status === "LilStack" && card.lilStackId ? "LilStack" : "BulkHold";
  }
  // A card only goes up for sale with a working pay link: create it before the status flips.
  else if (FOR_SALE.includes(status as never) && needsLink(card, s)) {
    const r = await issuePaymentLink(card, s);
    card = r.card;
    if (!r.ok) {
      linkError = r.error;
      // Stay out of the shop: back to Priced (or Bulk Hold if it's under the minimum).
      status = "NeedsLook";
    }
  } else if (!FOR_SALE.includes(status as never) && card.paymentLinkActive) {
    card = (await retirePaymentLink(card)).card;
  }

  if (status !== "LilStack" && card.lilStackId) await releaseFromPack(card);
  if (status === "Listed" && !card.listedAt) extra.listedAt = new Date();
  if (status === "Sold" && !card.soldAt) extra.soldAt = new Date();
  card = await db.card.update({ where: { id }, data: { status, ...extra } });
  if (linkError) return NextResponse.json({ ok: false, error: linkError, card }, { status: 422 });
  return NextResponse.json({ ok: true, card, wentLive: FOR_SALE.includes(status as never) && !FOR_SALE.includes(before.status as never), sold: status === "Sold" && before.status !== "Sold" });
});

export const DELETE = guarded(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const card = await db.card.findUniqueOrThrow({ where: { id } });
  await retirePaymentLink(card);
  await releaseFromPack(card);
  await db.card.update({ where: { id }, data: { status: "Archived" } });
  return NextResponse.json({ ok: true });
});
