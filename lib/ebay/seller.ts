import { randomBytes } from "node:crypto";
import type { Card } from "@prisma/client";
import { db } from "../db";
import { keys } from "../env";
import { STOCK } from "../game/packs";
import { presentCard } from "../present";
import { signedUrl } from "../storage";

/**
 * The eBay lane: one fixed-price listing per card ($3 and up, loose stock only), and a sold check.
 * Nothing lists until the seller login is connected (OAuth, refresh token kept server side in Setting "ebay:seller").
 * A card is claimed (status Listed, listedChannel ebay) before any eBay call, so the pack builder can't take it;
 * a failed call puts it straight back in stock with ebayError for the desk.
 */

const API = "https://api.ebay.com";
const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
].join(" ");
const SELLER_KEY = "ebay:seller";
const STATE_KEY = "ebay:state";
const SYNC_KEY = "ebay:lastSync";
export const EBAY_MIN = 3;
export const LOCATION_KEY = "TS-KISSIMMEE";
const SYNC_EVERY_MS = 5 * 60_000;
export const skuOf = (id: string) => `TS-${id}`;
export const idOfSku = (sku: string | undefined | null) => (sku && sku.startsWith("TS-") ? sku.slice(3) : null);

interface SellerTokens {
  refresh: string;
  refreshExp: number;
  access?: string;
  accessExp?: number;
  policies?: { fulfillment: string; payment: string; return: string };
}

const runame = () => process.env.EBAY_RUNAME || "";
export const ebayAppReady = () => !!(keys().ebayId && keys().ebaySecret && runame());

async function readJson<T>(key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}
const writeJson = (key: string, v: unknown) =>
  db.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(v) }, update: { value: JSON.stringify(v) } });

export async function ebayStatus() {
  const t = await readJson<SellerTokens>(SELLER_KEY);
  return { app: ebayAppReady(), connected: !!t && t.refreshExp > Date.now() };
}

export async function connectUrl() {
  const state = randomBytes(16).toString("hex");
  await writeJson(STATE_KEY, { state, exp: Date.now() + 15 * 60_000 });
  const q = new URLSearchParams({ client_id: keys().ebayId, response_type: "code", redirect_uri: runame(), scope: SCOPES, state });
  return `https://auth.ebay.com/oauth2/authorize?${q}`;
}

async function tokenCall(body: Record<string, string>) {
  const { ebayId, ebaySecret } = keys();
  const res = await fetch(`${API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${ebayId}:${ebaySecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`eBay login: ${j.error_description || `HTTP ${res.status}`}`);
  return j;
}

/** The callback: check state, trade the code for tokens, keep the refresh token. */
export async function finishConnect(code: string, state: string) {
  const saved = await readJson<{ state: string; exp: number }>(STATE_KEY);
  if (!saved || saved.state !== state || saved.exp < Date.now()) throw new Error("eBay login expired. Press Connect eBay again.");
  await db.setting.delete({ where: { key: STATE_KEY } }).catch(() => {});
  const j = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: runame() });
  await writeJson(SELLER_KEY, {
    refresh: j.refresh_token ?? "",
    refreshExp: Date.now() + (j.refresh_token_expires_in ?? 47_304_000) * 1000,
    access: j.access_token,
    accessExp: Date.now() + (j.expires_in ?? 7200) * 1000,
  } satisfies SellerTokens);
}

export async function disconnect() {
  await db.setting.deleteMany({ where: { key: SELLER_KEY } });
}

async function accessToken(): Promise<string> {
  const t = await readJson<SellerTokens>(SELLER_KEY);
  if (!t || t.refreshExp < Date.now()) throw new Error("eBay seller login isn't connected.");
  if (t.access && (t.accessExp ?? 0) > Date.now() + 60_000) return t.access;
  const j = await tokenCall({ grant_type: "refresh_token", refresh_token: t.refresh, scope: SCOPES });
  await writeJson(SELLER_KEY, { ...t, access: j.access_token, accessExp: Date.now() + (j.expires_in ?? 7200) * 1000 });
  return j.access_token!;
}

/** One seller API call. Throws a short readable error (eBay's own message) on failure. */
async function call<T = unknown>(method: string, path: string, body?: unknown, okStatus: number[] = []): Promise<{ status: number; data: T }> {
  const token = await accessToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "Accept-Language": "en-US",
      "X-EBAY-C-MARKETPLACE-ID": keys().ebayMarketplace,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.ok || okStatus.includes(res.status)) return { status: res.status, data: data as T };
  const errs = (data as { errors?: { errorId?: number; message?: string; longMessage?: string }[] } | null)?.errors ?? [];
  const msg = errs.map((e) => `${e.longMessage || e.message}${e.errorId ? ` (${e.errorId})` : ""}`).join("; ") || `HTTP ${res.status}`;
  throw new Error(`eBay: ${msg.slice(0, 300)}`);
}

/** Business policies + the shop's inventory location, looked up once and kept. */
async function setup(): Promise<NonNullable<SellerTokens["policies"]>> {
  const t = (await readJson<SellerTokens>(SELLER_KEY))!;
  if (t.policies) return t.policies;
  const mp = keys().ebayMarketplace;
  const first = async (kind: string, field: string) => {
    const { data } = await call<Record<string, { [k: string]: string }[]>>("GET", `/sell/account/v1/${kind}_policy?marketplace_id=${mp}`);
    const id = data?.[`${kind}Policies`]?.[0]?.[field];
    if (!id) throw new Error(`eBay: no ${kind} policy. Add shipping, payment and return policies in Seller Hub (Business policies), then list again.`);
    return id;
  };
  const policies = {
    fulfillment: await first("fulfillment", "fulfillmentPolicyId"),
    payment: await first("payment", "paymentPolicyId"),
    return: await first("return", "returnPolicyId"),
  };
  const loc = await call("GET", `/sell/inventory/v1/location/${LOCATION_KEY}`, undefined, [404]);
  if (loc.status === 404) {
    await call("POST", `/sell/inventory/v1/location/${LOCATION_KEY}`, {
      name: "Pokéroll",
      merchantLocationStatus: "ENABLED",
      locationTypes: ["WAREHOUSE"],
      location: { address: { addressLine1: "1424 Orchid Lane", city: "Kissimmee", stateOrProvince: "FL", postalCode: "34744", country: "US" } },
    });
  }
  await writeJson(SELLER_KEY, { ...t, policies });
  return policies;
}

type ListCard = Pick<Card, "id" | "name" | "player" | "game" | "category" | "setName" | "number" | "year" | "variant" | "listPrice" | "frontImage" | "cardType" | "status">;

/** "2023 Scarlet & Violet Pikachu #25" style, max 80 characters (eBay's limit). */
export function ebayTitle(c: Pick<ListCard, "name" | "player" | "game" | "setName" | "number" | "year" | "variant">) {
  const who = (c.game === "Sports" ? c.player || c.name : c.name) || "";
  const parts = [c.year ? String(c.year) : "", c.setName ?? "", who, c.variant ?? "", c.number ? `#${c.number}` : ""].map((s) => s.trim()).filter(Boolean);
  let t = parts.join(" ").replace(/\s+/g, " ");
  if (t.length > 80) t = [who, c.number ? `#${c.number}` : ""].filter(Boolean).join(" ").slice(0, 80);
  return t;
}

export const ebayCategory = (category: string | null) => (category === "pokemon" ? "183454" : "261328");

function aspects(c: ListCard): Record<string, string[]> {
  const a: Record<string, string[]> = { Graded: ["No"] };
  if (c.category === "pokemon") {
    a.Game = ["Pokémon TCG"];
    if (c.name) a["Character"] = [c.name];
  } else {
    a.Sport = [c.category === "baseball" ? "Baseball" : "Football"];
    if (c.player || c.name) a["Player/Athlete"] = [(c.player || c.name)!];
  }
  if (c.setName) a.Set = [c.setName];
  if (c.number) a["Card Number"] = [c.number];
  if (c.year) a.Season = [String(c.year)];
  return a;
}

/** Create/replace the inventory item, make or reuse its offer, publish. Returns the listing id. */
async function listOne(c: ListCard) {
  const policies = await setup();
  const rel = await presentCard(c);
  const image = rel ? await signedUrl(rel, 30 * 24 * 3600) : null;
  if (!image) throw new Error("No scan photo to send.");
  const sku = skuOf(c.id);
  const title = ebayTitle(c);
  if (!title) throw new Error("No name to list.");
  const description = `${title}. Real card from my little card shop, the photo is the actual card. Ships from Kissimmee, FL.`;
  await call("PUT", `/sell/inventory/v1/inventory_item/${sku}`, {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: "USED_VERY_GOOD",
    conditionDescriptors: [{ name: "40001", values: ["400010"] }], // ungraded, Near Mint or better
    product: { title, description, imageUrls: [image], aspects: aspects(c) },
  });
  const offer = {
    sku,
    marketplaceId: keys().ebayMarketplace,
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: ebayCategory(c.category),
    listingDescription: description,
    listingPolicies: { fulfillmentPolicyId: policies.fulfillment, paymentPolicyId: policies.payment, returnPolicyId: policies.return },
    pricingSummary: { price: { value: c.listPrice!.toFixed(2), currency: "USD" } },
    merchantLocationKey: LOCATION_KEY,
  };
  const found = await call<{ offers?: { offerId: string }[] }>("GET", `/sell/inventory/v1/offer?sku=${sku}`, undefined, [404]);
  let offerId = found.data?.offers?.[0]?.offerId;
  if (offerId) await call("PUT", `/sell/inventory/v1/offer/${offerId}`, offer);
  else offerId = (await call<{ offerId: string }>("POST", "/sell/inventory/v1/offer", offer)).data.offerId;
  const pub = await call<{ listingId: string }>("POST", `/sell/inventory/v1/offer/${offerId}/publish`);
  return { offerId, listingId: pub.data.listingId };
}

/** Loose stock eBay may take: priced $3+, in stock, in no pack, owned, readable, never energy. */
export const ebayWhere = (since?: Date) => ({
  status: { in: STOCK },
  gamePackId: null,
  lilStackId: null,
  listPrice: { gte: EBAY_MIN },
  readable: true,
  frontImage: { not: null },
  OR: [{ partnerId: { not: null } }, { senderId: { not: null } }],
  NOT: { name: { contains: "energy", mode: "insensitive" as const } },
  ...(since ? { AND: [{ OR: [{ ebayTriedAt: null }, { ebayTriedAt: { lt: since } }] }] } : {}),
});

/**
 * The List button, a few cards per call (requests stay short). `since` = when the founder pressed it,
 * so a card that failed in this run isn't retried in a loop.
 */
export async function listOnEbay(since: Date, max = 4, budgetMs = 40_000) {
  if (!(await ebayStatus()).connected) return { ok: false as const, error: "Connect the eBay seller login first. Nothing was listed." };
  const start = Date.now();
  const cards = await db.card.findMany({ where: ebayWhere(since), orderBy: { listPrice: "desc" }, take: max });
  let listed = 0;
  const failed: { name: string; error: string }[] = [];
  for (const c of cards) {
    if (Date.now() - start > budgetMs) break;
    const now = new Date();
    // Claim first: the pack builder only takes STOCK cards, so this card can't land in a pack mid-listing.
    const claim = await db.card.updateMany({
      where: { id: c.id, status: { in: STOCK }, gamePackId: null, lilStackId: null },
      data: { status: "Listed", listedChannel: "ebay", ebayTriedAt: now },
    });
    if (!claim.count) continue;
    try {
      const r = await listOne(c);
      await db.card.update({
        where: { id: c.id },
        data: { ebayOfferId: r.offerId, ebayListingId: r.listingId, listedUrl: `https://www.ebay.com/itm/${r.listingId}`, listedAt: now, ebayError: null },
      });
      listed++;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await db.card.update({ where: { id: c.id }, data: { status: c.status, listedChannel: null, ebayError: error.slice(0, 500) } });
      failed.push({ name: ebayTitle(c) || c.id, error });
      if (/isn't connected|no \w+ policy|eBay login/.test(error)) break; // same answer for every card
    }
  }
  const left = await db.card.count({ where: ebayWhere(since) });
  return { ok: true as const, listed, failed, left };
}

interface EbayOrder {
  orderId: string;
  creationDate: string;
  cancelStatus?: { cancelState?: string };
  lineItems: { sku?: string; total?: { value: string }; lineItemCost?: { value: string } }[];
}

/** Sold check: read recent orders, mark each listed card Sold (soldChannel ebay). Throttled to every 5 minutes. */
export async function syncEbaySales(force = false) {
  if (!(await ebayStatus()).connected) return { checked: false, sold: 0 };
  const last = await readJson<{ at: number }>(SYNC_KEY);
  if (!force && last && Date.now() - last.at < SYNC_EVERY_MS) return { checked: false, sold: 0 };
  const listedAny = await db.card.count({ where: { listedChannel: "ebay", status: "Listed" } });
  await writeJson(SYNC_KEY, { at: Date.now() });
  if (!listedAny) return { checked: true, sold: 0 };
  const from = new Date(last ? last.at - 60 * 60_000 : Date.now() - 30 * 86_400_000).toISOString(); // an hour of overlap; updates only touch still-listed cards
  let path: string | null = `/sell/fulfillment/v1/order?filter=${encodeURIComponent(`creationdate:[${from}..]`)}&limit=50`;
  let sold = 0;
  for (let page = 0; path && page < 4; page++) {
    const res: { data: { orders?: EbayOrder[]; next?: string } } = await call("GET", path);
    const data = res.data;
    for (const o of data?.orders ?? []) {
      if (o.cancelStatus?.cancelState === "CANCELED") continue;
      for (const li of o.lineItems ?? []) {
        const id = idOfSku(li.sku);
        if (!id) continue;
        const price = Number(li.lineItemCost?.value ?? li.total?.value);
        const n = await db.card.updateMany({
          where: { id, listedChannel: "ebay", status: "Listed" },
          data: { status: "Sold", soldChannel: "ebay", soldAt: new Date(o.creationDate), soldPrice: Number.isFinite(price) ? price : null, ebayOrderId: o.orderId },
        });
        sold += n.count;
      }
    }
    path = data?.next ? data.next.replace(API, "") : null;
  }
  return { checked: true, sold };
}

/** What the desk's eBay lane shows. */
export async function ebayLane() {
  const [status, ready, onEbay, soldEbay, failed] = await Promise.all([
    ebayStatus(),
    db.card.count({ where: ebayWhere() }),
    db.card.findMany({ where: { listedChannel: "ebay", status: "Listed" }, orderBy: { listedAt: "desc" }, take: 200 }),
    db.card.findMany({ where: { soldChannel: "ebay", status: "Sold" }, orderBy: { soldAt: "desc" }, take: 50 }),
    db.card.findMany({ where: { ...ebayWhere(), ebayError: { not: null } }, orderBy: { ebayTriedAt: "desc" }, take: 50 }),
  ]);
  const row = (c: Card) => ({ id: c.id, title: ebayTitle(c) || "Unnamed card", price: c.listPrice, code: c.location ?? "—", url: c.listedUrl, error: c.ebayError, soldAt: c.soldAt?.toISOString() ?? null, soldPrice: c.soldPrice });
  return { ...status, ready, onEbay: onEbay.map(row), sold: soldEbay.map(row), failed: failed.map(row) };
}
