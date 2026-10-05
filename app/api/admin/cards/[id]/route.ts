import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { db } from "@/lib/db";
import { applySuggestion, priceCard, relinkCatalog } from "@/lib/pipeline";
import { getSettings } from "@/lib/settings";
import { isCategory } from "@/lib/categories";
import { buildGamePacks, releaseCardFromGame } from "@/lib/game/packs";
import { retirePaymentLink } from "@/lib/payLink";
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
  // Which pack it goes in. Set by hand it sticks; empty = never packed.
  if ("category" in b) {
    data.category = isCategory(b.category) ? b.category : null;
    data.categorySource = "manual";
  }
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

  // Status moves only from my hand. Cards never sell one at a time: Ready/Listed aren't allowed any more.
  let status = card.status;
  let linkError: string | undefined;
  if (typeof b.status === "string" && FOR_SALE.includes(b.status as never)) {
    linkError = "Cards sell only in packs now. Approve it and it joins its category's next pack.";
  }
  // LilStack is only set by packing (a card needs a pack to be in one).
  else if (typeof b.status === "string" && (STATUSES as readonly string[]).includes(b.status) && (b.status !== "LilStack" || card.gamePackId)) status = b.status;
  // Saving a card I'm looking at approves it: back to stock, and the packer takes it from there.
  else if (b.confirm && card.readable && ["Inbox", "Identified", "Priced", "BulkHold", "NeedsLook", "Pulled"].includes(card.status)) {
    status = card.listPrice == null ? "Identified" : "Priced";
  }
  const extra: Prisma.CardUpdateInput = {};
  if (card.soldPrice != null && before.soldPrice == null && status !== "Sold") status = "Sold";
  // Old single-card pay links never stay up.
  if (card.paymentLinkActive) card = (await retirePaymentLink(card)).card;

  // Out of an available pack (that pack is drawn again). A pack a player holds or bought is left alone.
  if (status !== "LilStack" && card.gamePackId) await releaseCardFromGame(card);
  // Approving it clears why it was waiting, including a rotation hold.
  if (b.confirm && status === "Priced" && card.holdReason) extra.holdReason = null;
  if (status === "Sold" && !card.soldAt) extra.soldAt = new Date();
  card = await db.card.update({ where: { id }, data: { status, ...extra } });

  // Draw new packs in the categories this card touched (its bins may now fill one).
  const cats = new Set([before.category, card.category].filter(isCategory));
  for (const c of cats) await buildGamePacks(c).catch((e) => console.error("pack build failed", e));
  card = await db.card.findUniqueOrThrow({ where: { id } });

  if (linkError) return NextResponse.json({ ok: false, error: linkError, card }, { status: 422 });
  return NextResponse.json({ ok: true, card, packed: card.status === "LilStack" && before.status !== "LilStack", sold: status === "Sold" && before.status !== "Sold" });
});

export const DELETE = guarded(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const card = await db.card.findUniqueOrThrow({ where: { id } });
  await retirePaymentLink(card);
  await releaseCardFromGame(card);
  await db.card.update({ where: { id }, data: { status: "Archived" } });
  return NextResponse.json({ ok: true });
});
