import type { Buyer, ShipQuote } from "@prisma/client";
import { productName } from "../categories";
import { db } from "../db";
import { sendMail } from "../mail";
import { buyLabel, downloadLabel, easypostReady, FALLBACK_SHIPPING, groundAdvantageRate, SERVICE, verifyAddress, type ShipToAddress } from "../ship/easypost";
import { putObject } from "../storage";
import { safeJson } from "../util";
import { perkLeft, usePerk } from "./member";

/**
 * Shipping for the game. One service (USPS Ground Advantage), one fixed parcel, one line shown before Keep or a blind
 * buy, charged together with the pack. Up to 3 packs share one parcel and one label: the first pays, the next two
 * ride along while it hasn't shipped. A single pack never ships free (the member mailer credit is the one exception
 * the member pays for). If EasyPost is down, $5.95 is charged and I buy the label from the order.
 */
export const MAX_PACKS_PER_PARCEL = 3;
const JOIN_WINDOW_MS = 24 * 3600_000;
const QUOTE_TTL_MS = 30 * 60_000;

export interface ShipLine {
  quoteId: string;
  amount: number;
  how: string;
  label: string;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export function shipAddress(b: Pick<Buyer, "name" | "shipTo">): ShipToAddress {
  const s = safeJson<{ name?: string; address?: { line1?: string; line2?: string; city?: string; state?: string; postal?: string } }>(b.shipTo, {});
  return { name: s.name || b.name, street1: s.address?.line1 ?? "", street2: s.address?.line2 ?? "", city: s.address?.city ?? "", state: s.address?.state ?? "", zip: s.address?.postal ?? "" };
}

/** An unshipped parcel this player can still add a pack to. */
async function openParcel(buyerId: string, now = new Date()) {
  const o = await db.shipOrder.findFirst({
    where: { buyerId, shippedAt: null, createdAt: { gt: new Date(now.getTime() - JOIN_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    include: { packs: { select: { number: true, category: true } } },
  });
  return o && o.packs.length < MAX_PACKS_PER_PARCEL ? o : null;
}

export function lineFor(q: Pick<ShipQuote, "id" | "amount" | "how">, joinLabel?: string | null): ShipLine {
  const label =
    q.how === "join"
      ? `Ships with ${joinLabel ?? "your last pack"} · $0.00`
      : q.how === "credit"
        ? `${SERVICE.label} · member mailer credit · $0.00`
        : `${SERVICE.label} · ${money(q.amount)}`;
  return { quoteId: q.id, amount: q.amount, how: q.how, label };
}

/** Verify the player's address with EasyPost and remember it (signup, and checkout if it wasn't verified yet). */
export async function ensureVerified(buyer: Buyer): Promise<{ ok: true; id: string } | { ok: false; error: string; timeout: boolean }> {
  if (buyer.addressVerified && buyer.easypostAddressId) return { ok: true, id: buyer.easypostAddressId };
  const v = await verifyAddress(shipAddress(buyer));
  if (v.ok) await db.buyer.update({ where: { id: buyer.id }, data: { easypostAddressId: v.id, addressVerified: true } });
  return v;
}

/** The single shipping line for this player's next pack. */
export async function quoteShipping(buyer: Buyer): Promise<ShipLine> {
  const open = await openParcel(buyer.id);
  if (open) {
    const q = await db.shipQuote.create({ data: { buyerId: buyer.id, amount: 0, how: "join", joinOrderId: open.id } });
    const first = open.packs[0];
    return lineFor(q, first ? `${productName(first.category)} ${first.number ?? ""}`.trim() : null);
  }
  const credit = await perkLeft(buyer, "mailer");
  let rate: { shipmentId: string; rateId: string; amount: number } | null = null;
  let error: string | null = null;
  if (!easypostReady()) error = "EasyPost isn't set up";
  else {
    const v = await ensureVerified(buyer);
    if (!v.ok) error = v.error;
    else
      try {
        rate = await groundAdvantageRate(v.id);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
  }
  const how = credit ? "credit" : rate ? "rate" : "fallback";
  const amount = credit ? 0 : rate ? rate.amount : FALLBACK_SHIPPING;
  const q = await db.shipQuote.create({
    data: { buyerId: buyer.id, amount, how, shipmentId: rate?.shipmentId, rateId: rate?.rateId, rateAmount: rate?.amount, error: error?.slice(0, 300) },
  });
  return lineFor(q);
}

/** A quote the player saw, still good to charge: theirs, unused, recent, and (for a join) the parcel is still open. */
export async function validQuote(buyer: Buyer, quoteId: string | null | undefined, now = new Date()) {
  if (!quoteId) return null;
  const q = await db.shipQuote.findFirst({ where: { id: quoteId, buyerId: buyer.id, usedAt: null } });
  if (!q || now.getTime() - q.createdAt.getTime() > QUOTE_TTL_MS) return null;
  if (q.how === "join" && !(await openParcel(buyer.id, now))) return null;
  if (q.how === "credit" && !(await perkLeft(buyer, "mailer"))) return null;
  return q;
}

/**
 * After the charge went through: put the pack in a parcel. A new parcel buys its label right away (PDF stored,
 * tracking emailed). A fallback parcel waits for me to buy the label from the order.
 */
export async function placeInParcel(buyer: Buyer, quote: ShipQuote, packId: string) {
  await db.shipQuote.update({ where: { id: quote.id }, data: { usedAt: new Date() } });
  if (quote.how === "join" && quote.joinOrderId) {
    await db.gamePack.update({ where: { id: packId }, data: { orderId: quote.joinOrderId } });
    return db.shipOrder.findUniqueOrThrow({ where: { id: quote.joinOrderId } });
  }
  if (quote.how === "credit") await usePerk(buyer, "mailer");
  const order = await db.shipOrder.create({
    data: {
      buyerId: buyer.id,
      shipTo: buyer.shipTo,
      shippingCharged: quote.amount,
      how: quote.how,
      shipmentId: quote.shipmentId,
      rateId: quote.rateId,
      labelCost: quote.rateAmount,
      packs: { connect: [{ id: packId }] },
    },
  });
  if (quote.how === "fallback") return order;
  return buyAndStoreLabel(order.id).catch(() => order);
}

/** Buy the parcel's label (making the shipment first if it doesn't have one), store the PDF, email tracking. */
export async function buyAndStoreLabel(orderId: string) {
  const order = await db.shipOrder.findUniqueOrThrow({ where: { id: orderId }, include: { buyer: true, packs: { select: { number: true, category: true } } } });
  if (order.labelPath) return order;
  try {
    let { shipmentId, rateId } = order;
    if (!shipmentId || !rateId) {
      const v = await ensureVerified(order.buyer);
      if (!v.ok) throw new Error(v.error);
      const r = await groundAdvantageRate(v.id);
      shipmentId = r.shipmentId;
      rateId = r.rateId;
    }
    const label = await buyLabel(shipmentId, rateId);
    const labelPath = `labels/${order.id}.pdf`;
    await putObject(labelPath, await downloadLabel(label.labelUrl), "application/pdf");
    const updated = await db.shipOrder.update({
      where: { id: order.id },
      data: { shipmentId, rateId, labelPath, labelError: null, trackingCode: label.trackingCode, trackingUrl: label.trackingUrl, labelCost: label.cost ?? order.labelCost },
    });
    const packs = order.packs.map((p) => `${productName(p.category)} ${p.number ?? ""}`.trim()).join(", ");
    const mail = await sendMail({
      to: order.buyer.email,
      subject: "Your Trade Shark pack is on its way",
      text: `Hi ${order.buyer.name}!\n\nYour ${packs} ships from Florida by USPS Ground Advantage.\nTracking: ${label.trackingUrl}\n\nThanks for playing!\nTrade Shark`,
    });
    return db.shipOrder.update({ where: { id: updated.id }, data: mail.ok ? { emailedAt: new Date(), emailError: null } : { emailError: mail.error } });
  } catch (e) {
    return db.shipOrder.update({ where: { id: order.id }, data: { labelError: (e instanceof Error ? e.message : String(e)).slice(0, 300) } });
  }
}
