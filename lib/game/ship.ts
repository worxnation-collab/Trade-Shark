import type { Buyer, ShipQuote } from "@prisma/client";
import { productName } from "../categories";
import { db } from "../db";
import { sendMail } from "../mail";
import { buyLabel, downloadLabel, FALLBACK_SHIPPING, groundAdvantageRate, isShippoAddressId, parcelFor, SERVICE, shippingReady, verifyAddress, type ShipToAddress } from "../ship/shippo";
import { putObject } from "../storage";
import { safeJson } from "../util";
import { chargeApi, chargeSaved, refund, type ChargeApi } from "./charge";
import { perkLeft, usePerk } from "./member";

/**
 * Shipping, from the Collection. Buying a pack never ships it: a kept or blind pack is stored on the account
 * (GamePack.orderId = null). The player picks one or more stored packs, confirms the address, sees one USPS Ground
 * Advantage rate for one combined parcel, and pays shipping only. One label for the whole selection. Nothing auto-ships.
 * The member mailer credit zeros one parcel a billing period. If the Shippo rate fails, $5.95 is charged and I buy the
 * label from the order.
 */
const QUOTE_TTL_MS = 30 * 60_000;
export const BOUGHT = ["kept", "sold-blind"];

export interface ShipLine {
  quoteId: string;
  amount: number;
  how: string;
  label: string;
  packs: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export interface ShipToFields {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal: string;
}

export function shipFields(b: Pick<Buyer, "name" | "shipTo">): ShipToFields {
  const s = safeJson<{ name?: string; address?: { line1?: string; line2?: string; city?: string; state?: string; postal?: string } }>(b.shipTo, {});
  return { name: s.name || b.name, line1: s.address?.line1 ?? "", line2: s.address?.line2 ?? "", city: s.address?.city ?? "", state: s.address?.state ?? "", postal: s.address?.postal ?? "" };
}

export function shipAddress(b: Pick<Buyer, "name" | "shipTo">): ShipToAddress {
  const f = shipFields(b);
  return { name: f.name, street1: f.line1, street2: f.line2, city: f.city, state: f.state, zip: f.postal };
}

/** A clean US address from a form, or null if something's missing. */
export function cleanAddress(a: Partial<Record<keyof ShipToFields, unknown>>): ShipToFields | null {
  const t = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max);
  const f = { name: t(a.name), line1: t(a.line1), line2: t(a.line2), city: t(a.city), state: t(a.state, 2).toUpperCase(), postal: t(a.postal, 10) };
  if (!f.name || !f.line1 || !f.city || !/^[A-Z]{2}$/.test(f.state) || !/^\d{5}(-\d{4})?$/.test(f.postal)) return null;
  return f;
}

export function lineFor(q: Pick<ShipQuote, "id" | "amount" | "how" | "packIds">): ShipLine {
  const label = q.how === "credit" ? `${SERVICE.label} · member mailer credit · $0.00` : `${SERVICE.label} · ${money(q.amount)}`;
  return { quoteId: q.id, amount: q.amount, how: q.how, label, packs: q.packIds.length };
}

/** Verify the player's address with Shippo and remember it (signup, and again before a rate if it wasn't verified). */
export async function ensureVerified(buyer: Buyer): Promise<{ ok: true; id: string } | { ok: false; error: string; timeout: boolean }> {
  // easypostAddressId holds the Shippo address id (column kept from EasyPost; old EasyPost ids are verified again).
  if (buyer.addressVerified && isShippoAddressId(buyer.easypostAddressId)) return { ok: true, id: buyer.easypostAddressId! };
  const v = await verifyAddress(shipAddress(buyer));
  if (v.ok) await db.buyer.update({ where: { id: buyer.id }, data: { easypostAddressId: v.id, addressVerified: true } });
  return v;
}

/** The player's bought packs, newest first; `orderId` null = still in the Collection, waiting to ship. */
export async function collection(buyerId: string) {
  return db.gamePack.findMany({
    where: { reservedBy: buyerId, status: { in: BOUGHT } },
    orderBy: { closedAt: "desc" },
    select: { id: true, number: true, category: true, kind: true, status: true, value: true, closedAt: true, orderId: true, order: { select: { trackingUrl: true, shippedAt: true, labelPath: true, createdAt: true } } },
  });
}

/** Of these ids, the ones that are this player's and not shipped yet. */
async function storedPacks(buyerId: string, ids: string[]) {
  if (!ids.length) return [];
  return db.gamePack.findMany({ where: { id: { in: ids }, reservedBy: buyerId, status: { in: BOUGHT }, orderId: null }, select: { id: true, number: true, category: true } });
}

/**
 * Step 1 of Ship: confirm (or change) the address, then one rate for one parcel holding the selected packs.
 * A changed address is saved and verified first; USPS has to be able to deliver it.
 */
export async function quoteShipment(buyerIn: Buyer, packIds: string[], address?: ShipToFields | null) {
  const ids = [...new Set(packIds.map(String))];
  const packs = await storedPacks(buyerIn.id, ids);
  if (!packs.length || packs.length !== ids.length) return { ok: false as const, error: "Pick packs from your collection that haven't shipped yet." };
  let buyer = buyerIn;
  if (address) {
    const cur = shipFields(buyer);
    const changed = (Object.keys(address) as (keyof ShipToFields)[]).some((k) => (address[k] ?? "") !== (cur[k] ?? ""));
    if (changed) {
      const s = safeJson<Record<string, unknown>>(buyer.shipTo, {});
      buyer = await db.buyer.update({
        where: { id: buyer.id },
        data: { shipTo: JSON.stringify({ ...s, name: address.name, address: { ...address, country: "US" } }), easypostAddressId: null, addressVerified: false },
      });
    }
  }
  const credit = await perkLeft(buyer, "mailer");
  let rate: { shipmentId: string; rateId: string; amount: number } | null = null;
  let error: string | null = null;
  if (!shippingReady()) error = "no shipping key: flat rate";
  else {
    const v = await ensureVerified(buyer);
    if (!v.ok && !v.timeout) return { ok: false as const, error: `USPS can't deliver to that address: ${v.error}`, code: "address" };
    if (!v.ok) error = v.error;
    else
      try {
        rate = await groundAdvantageRate(v.id, parcelFor(packs.length));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
  }
  const how = credit ? "credit" : rate ? "rate" : "fallback";
  const amount = credit ? 0 : rate ? rate.amount : FALLBACK_SHIPPING;
  const q = await db.shipQuote.create({
    data: { buyerId: buyer.id, amount, how, packIds: ids, shipmentId: rate?.shipmentId, rateId: rate?.rateId, rateAmount: rate?.amount, error: error?.slice(0, 300) },
  });
  return { ok: true as const, ship: lineFor(q), address: shipFields(buyer) };
}

/** A quote the player saw, still good to charge: theirs, unused, recent, and (for a credit) the credit's still there. */
export async function validQuote(buyer: Buyer, quoteId: string | null | undefined, now = new Date()) {
  if (!quoteId) return null;
  const q = await db.shipQuote.findFirst({ where: { id: quoteId, buyerId: buyer.id, usedAt: null } });
  if (!q || !q.packIds.length || now.getTime() - q.createdAt.getTime() > QUOTE_TTL_MS) return null;
  if (q.how === "credit" && !(await perkLeft(buyer, "mailer"))) return null;
  return q;
}

/**
 * Step 2 of Ship: claim the packs into one parcel, charge shipping only (nothing if the mailer credit covers it),
 * then buy the one label. A declined card puts the packs back in the Collection.
 */
export async function shipStored(buyer: Buyer, quoteId: string, opts: { api?: ChargeApi | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const quote = await validQuote(buyer, quoteId, now);
  if (!quote) return { ok: false as const, error: "That shipping price expired. Check it again.", code: "ship-changed" };
  if (quote.amount > 0 && !buyer.paymentMethodId) return { ok: false as const, error: "Save a card first.", code: "no-card" };
  // Claim: the quote and every pack in it, at once (double taps and a second tab lose here).
  const order = await db
    .$transaction(async (tx) => {
      const used = await tx.shipQuote.updateMany({ where: { id: quote.id, usedAt: null }, data: { usedAt: now } });
      if (!used.count) throw new Error("quote used");
      const o = await tx.shipOrder.create({
        data: { buyerId: buyer.id, shipTo: buyer.shipTo, shippingCharged: quote.amount, how: quote.how, shipmentId: quote.shipmentId, rateId: quote.rateId, labelCost: quote.rateAmount },
      });
      const n = await tx.gamePack.updateMany({ where: { id: { in: quote.packIds }, reservedBy: buyer.id, status: { in: BOUGHT }, orderId: null }, data: { orderId: o.id } });
      if (n.count !== quote.packIds.length) throw new Error("pack moved");
      return o;
    })
    .catch(() => null);
  if (!order) return { ok: false as const, error: "Some of those packs already shipped. Pick again.", code: "ship-changed" };
  const unclaim = async () => {
    await db.gamePack.updateMany({ where: { orderId: order.id }, data: { orderId: null } });
    await db.shipOrder.delete({ where: { id: order.id } });
  };
  const api = opts.api !== undefined ? opts.api : chargeApi();
  if (quote.amount > 0) {
    const n = quote.packIds.length;
    const paid = await chargeSaved(buyer, quote.amount, "ship", null, `Trade Shark · shipping ${n} pack${n === 1 ? "" : "s"}`, api, order.id);
    if (!paid.ok) {
      await unclaim();
      return { ok: false as const, error: paid.error, code: "declined" };
    }
    await db.shipOrder.update({ where: { id: order.id }, data: { paymentIntentId: paid.paymentIntentId } });
  } else if (quote.how === "credit") await usePerk(buyer, "mailer");
  const done = quote.how === "fallback" ? order : await buyAndStoreLabel(order.id).catch(() => order);
  return { ok: true as const, orderId: order.id, shipping: quote.amount, packs: quote.packIds.length, tracking: done.trackingUrl ?? null };
}

/** Refund a parcel's shipping (I cancel a shipment by hand). */
export async function refundShipping(orderId: string, api: ChargeApi | null = chargeApi()) {
  const o = await db.shipOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (!o.paymentIntentId) return null;
  return refund(o.buyerId, null, o.paymentIntentId, o.shippingCharged, api);
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
      const r = await groundAdvantageRate(v.id, parcelFor(order.packs.length));
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
      subject: "Your Trade Shark packs are on their way",
      text: `Hi ${order.buyer.name}!\n\nYour ${packs} ship${order.packs.length === 1 ? "s" : ""} from Florida by USPS Ground Advantage.\nTracking: ${label.trackingUrl}\n\nThanks for playing!\nTrade Shark`,
    });
    return db.shipOrder.update({ where: { id: updated.id }, data: mail.ok ? { emailedAt: new Date(), emailError: null } : { emailError: mail.error } });
  } catch (e) {
    return db.shipOrder.update({ where: { id: order.id }, data: { labelError: (e instanceof Error ? e.message : String(e)).slice(0, 300) } });
  }
}
