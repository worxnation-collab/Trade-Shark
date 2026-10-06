/**
 * EasyPost, one service only: USPS Ground Advantage, fixed parcel 6 × 4 × 1 in, 4 oz, from the shop in Kissimmee.
 * Plain fetch with the API key (EASYPOST_API_KEY). Every call has a timeout; callers fall back to $5.95 when it trips.
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
export const SERVICE = { carrier: "USPS", service: "GroundAdvantage", label: "USPS Ground Advantage" } as const;
export const FALLBACK_SHIPPING = 5.95;
const TIMEOUT_MS = Number(process.env.EASYPOST_TIMEOUT_MS || 8000);

export const easypostReady = () => !!process.env.EASYPOST_API_KEY;

export class EasyPostError extends Error {
  constructor(
    message: string,
    public timeout = false,
  ) {
    super(message);
  }
}

async function ep<T>(path: string, body?: unknown): Promise<T> {
  const key = process.env.EASYPOST_API_KEY;
  if (!key) throw new EasyPostError("EASYPOST_API_KEY is not set", true);
  const base = (process.env.EASYPOST_API_BASE || "https://api.easypost.com/v2").replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Timeouts and network failures are treated the same: fall back, let the operator buy the label later.
    throw new EasyPostError(e instanceof Error ? `EasyPost unreachable: ${e.message}` : "EasyPost unreachable", true);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new EasyPostError(json.error?.message || `EasyPost ${res.status}`, res.status >= 500);
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

/** Verify a US delivery address. ok=false with timeout=false means USPS says it isn't deliverable. */
export async function verifyAddress(a: ShipToAddress): Promise<{ ok: true; id: string } | { ok: false; error: string; timeout: boolean }> {
  try {
    const r = await ep<{ id: string; verifications?: { delivery?: { success: boolean; errors?: { message: string }[] } } }>("/addresses", {
      verify: ["delivery"],
      address: { ...a, street2: a.street2 || undefined, country: "US" },
    });
    const d = r.verifications?.delivery;
    if (d && !d.success) return { ok: false, error: d.errors?.[0]?.message || "USPS can't deliver to that address", timeout: false };
    return { ok: true, id: r.id };
  } catch (e) {
    const err = e as EasyPostError;
    return { ok: false, error: err.message, timeout: !!err.timeout };
  }
}

/** One rate: create the shipment for the parcel and take the USPS Ground Advantage rate. */
export async function groundAdvantageRate(toAddressId: string, parcel: { length: number; width: number; height: number; weight: number } = PARCEL) {
  const s = await ep<{ id: string; rates?: { id: string; carrier: string; service: string; rate: string }[]; messages?: { message: string }[] }>("/shipments", {
    shipment: { to_address: { id: toAddressId }, from_address: FROM_ADDRESS, parcel, options: { label_format: "PDF" } },
  });
  const rate = s.rates?.find((r) => r.carrier === SERVICE.carrier && r.service === SERVICE.service);
  if (!rate) throw new EasyPostError(`No USPS Ground Advantage rate${s.messages?.[0] ? `: ${s.messages[0].message}` : ""}`);
  return { shipmentId: s.id, rateId: rate.id, amount: Math.round(Number(rate.rate) * 100) / 100 };
}

/** Buy the label for a shipment's rate. Returns the tracking code, a public tracking link and the PDF url. */
export async function buyLabel(shipmentId: string, rateId: string) {
  const s = await ep<{
    tracking_code?: string;
    tracker?: { public_url?: string };
    postage_label?: { label_url?: string; label_pdf_url?: string };
    selected_rate?: { rate?: string };
  }>(`/shipments/${shipmentId}/buy`, { rate: { id: rateId } });
  const labelUrl = s.postage_label?.label_pdf_url || s.postage_label?.label_url;
  if (!labelUrl || !s.tracking_code) throw new EasyPostError("EasyPost bought the label but sent no PDF or tracking code");
  return {
    trackingCode: s.tracking_code,
    trackingUrl: s.tracker?.public_url || `https://tools.usps.com/go/TrackConfirmAction?tLabels=${s.tracking_code}`,
    labelUrl,
    cost: s.selected_rate?.rate ? Number(s.selected_rate.rate) : null,
  };
}

export async function downloadLabel(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new EasyPostError(`Couldn't download the label (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
