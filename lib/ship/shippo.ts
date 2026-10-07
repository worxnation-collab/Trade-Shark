/**
 * Shippo, one service only: USPS Ground Advantage, one parcel (6 × 4 in, 4 oz + 1.5 oz per extra pack), from the shop
 * in Kissimmee. Plain fetch with the API key (SHIPPO_API_KEY, server only). Every call has a timeout; a failed or
 * missing rate falls back to $5.95 and I buy the label from the order.
 */
export const FROM_ADDRESS = { name: "Trade Shark", street1: "1424 Orchid Lane", city: "Kissimmee", state: "FL", zip: "34744", country: "US" };
export const PARCEL = { length: 6, width: 4, height: 1, weight: 4 }; // inches, ounces: one pack
/** Each extra pack in the same parcel adds this much weight; every 4 packs add an inch of height. */
export const EXTRA_PACK_OZ = 1.5;

/** The one parcel for a shipment of `packs` stored packs (same 6 × 4 footprint). */
export function parcelFor(packs: number) {
  const n = Math.max(1, Math.floor(packs));
  return { ...PARCEL, height: PARCEL.height * Math.ceil(n / 4), weight: PARCEL.weight + EXTRA_PACK_OZ * (n - 1) };
}
export const SERVICE = { carrier: "USPS", token: "usps_ground_advantage", label: "USPS Ground Advantage" } as const;
export const FALLBACK_SHIPPING = 5.95;
const TIMEOUT_MS = Number(process.env.SHIPPO_TIMEOUT_MS || 10000);

export const shippingReady = () => !!process.env.SHIPPO_API_KEY;

/** A Shippo address id (32 hex). Older rows may hold an EasyPost id; those are verified again. */
export const isShippoAddressId = (id: string | null | undefined) => !!id && /^[0-9a-f]{32}$/.test(id);

export class ShipError extends Error {
  constructor(
    message: string,
    public timeout = false,
  ) {
    super(message);
  }
}

async function shippo<T>(path: string, body?: unknown): Promise<T> {
  const key = process.env.SHIPPO_API_KEY;
  if (!key) throw new ShipError("Shipping isn't set up", true);
  const base = (process.env.SHIPPO_API_BASE || "https://api.goshippo.com").replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `ShippoToken ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Timeouts and network failures are treated the same: fall back, let the operator buy the label later.
    throw new ShipError(e instanceof Error ? `Shippo unreachable: ${e.message}` : "Shippo unreachable", true);
  }
  const json = (await res.json().catch(() => ({}))) as { detail?: string } & T;
  if (!res.ok) throw new ShipError(json.detail || `Shippo ${res.status}`, res.status >= 500);
  return json;
}

export interface ShipToAddress {
  name: string;
  street1: string;
  street2?: string | null;
  city: string;
  state: string;
  zip: string;
}

type Msg = { text?: string; code?: string; type?: string };

/** Verify a US delivery address. ok=false with timeout=false means USPS says it isn't deliverable. */
export async function verifyAddress(a: ShipToAddress): Promise<{ ok: true; id: string } | { ok: false; error: string; timeout: boolean }> {
  try {
    const r = await shippo<{ object_id: string; validation_results?: { is_valid?: boolean; messages?: Msg[] } }>("/addresses/", {
      name: a.name,
      street1: a.street1,
      street2: a.street2 || "",
      city: a.city,
      state: a.state,
      zip: a.zip,
      country: "US",
      validate: true,
    });
    const v = r.validation_results;
    if (v && v.is_valid === false) return { ok: false, error: v.messages?.[0]?.text || "USPS can't deliver to that address", timeout: false };
    return { ok: true, id: r.object_id };
  } catch (e) {
    const err = e as ShipError;
    return { ok: false, error: err.message, timeout: !!err.timeout };
  }
}

/** One rate: make the shipment for the parcel and take the USPS Ground Advantage rate. */
export async function groundAdvantageRate(toAddressId: string, parcel: { length: number; width: number; height: number; weight: number } = PARCEL) {
  const s = await shippo<{ object_id: string; rates?: { object_id: string; provider: string; amount: string; servicelevel?: { token?: string } }[]; messages?: Msg[] }>("/shipments/", {
    address_from: FROM_ADDRESS,
    address_to: toAddressId,
    parcels: [{ length: String(parcel.length), width: String(parcel.width), height: String(parcel.height), distance_unit: "in", weight: String(parcel.weight), mass_unit: "oz" }],
    async: false,
  });
  const rate = s.rates?.find((r) => r.provider === SERVICE.carrier && r.servicelevel?.token === SERVICE.token);
  if (!rate) throw new ShipError(`No USPS Ground Advantage rate${s.messages?.[0]?.text ? `: ${s.messages[0].text}` : ""}`);
  return { shipmentId: s.object_id, rateId: rate.object_id, amount: Math.round(Number(rate.amount) * 100) / 100 };
}

/** Buy the label for a rate (only after Stripe took the shipping). Returns the tracking code, a tracking link and the PDF url. */
export async function buyLabel(_shipmentId: string, rateId: string) {
  const t = await shippo<{
    status?: string;
    tracking_number?: string;
    tracking_url_provider?: string;
    label_url?: string;
    messages?: Msg[];
  }>("/transactions/", { rate: rateId, label_file_type: "PDF_4x6", async: false });
  if (t.status !== "SUCCESS") throw new ShipError(`Shippo didn't buy the label${t.messages?.[0]?.text ? `: ${t.messages[0].text}` : ""}`);
  if (!t.label_url || !t.tracking_number) throw new ShipError("Shippo bought the label but sent no PDF or tracking number");
  return {
    trackingCode: t.tracking_number,
    trackingUrl: t.tracking_url_provider || `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t.tracking_number}`,
    labelUrl: t.label_url,
    cost: null as number | null,
  };
}

export async function downloadLabel(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new ShipError(`Couldn't download the label (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
