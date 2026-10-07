import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buyLabel, groundAdvantageRate, isShippoAddressId, parcelFor, verifyAddress } from "@/lib/ship/shippo";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
let calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
function serve(...replies: unknown[]) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body ?? "{}")), auth: String((init.headers as Record<string, string>).Authorization) });
    return ok(replies.shift());
  });
}
const addr = { name: "Pat", street1: "1 Main St", city: "Orlando", state: "FL", zip: "32801" };

beforeEach(() => {
  calls = [];
  process.env.SHIPPO_API_KEY = "test_key";
});
afterEach(() => vi.unstubAllGlobals());

describe("shippo", () => {
  it("verifies an address and keeps its id", async () => {
    serve({ object_id: "a".repeat(32), validation_results: { is_valid: true } });
    expect(await verifyAddress(addr)).toEqual({ ok: true, id: "a".repeat(32) });
    expect(calls[0].url).toMatch(/\/addresses\/$/);
    expect(calls[0].body.validate).toBe(true);
    expect(calls[0].auth).toBe("ShippoToken test_key");
  });

  it("says an undeliverable address is not a timeout", async () => {
    serve({ object_id: "b".repeat(32), validation_results: { is_valid: false, messages: [{ text: "Address not found" }] } });
    expect(await verifyAddress(addr)).toEqual({ ok: false, error: "Address not found", timeout: false });
  });

  it("takes only the USPS Ground Advantage rate for the combined parcel", async () => {
    serve({
      object_id: "ship1",
      rates: [
        { object_id: "r-pri", provider: "USPS", amount: "9.10", servicelevel: { token: "usps_priority" } },
        { object_id: "r-ga", provider: "USPS", amount: "4.634", servicelevel: { token: "usps_ground_advantage" } },
      ],
    });
    expect(await groundAdvantageRate("a".repeat(32), parcelFor(5))).toEqual({ shipmentId: "ship1", rateId: "r-ga", amount: 4.63 });
    const parcel = (calls[0].body.parcels as Record<string, string>[])[0];
    expect(parcel).toMatchObject({ height: "2", weight: "10", mass_unit: "oz", distance_unit: "in" });
  });

  it("throws when there is no Ground Advantage rate (caller falls back to $5.95)", async () => {
    serve({ object_id: "ship2", rates: [{ object_id: "r", provider: "UPS", amount: "12", servicelevel: { token: "ups_ground" } }] });
    await expect(groundAdvantageRate("a".repeat(32))).rejects.toThrow(/Ground Advantage/);
  });

  it("buys the label and returns tracking and the PDF", async () => {
    serve({ status: "SUCCESS", tracking_number: "9400", tracking_url_provider: "https://usps/9400", label_url: "https://shippo/label.pdf" });
    expect(await buyLabel("ship1", "r-ga")).toMatchObject({ trackingCode: "9400", trackingUrl: "https://usps/9400", labelUrl: "https://shippo/label.pdf" });
    expect(calls[0].body).toMatchObject({ rate: "r-ga", label_file_type: "PDF_4x6", async: false });
  });

  it("re-verifies old EasyPost address ids", () => {
    expect(isShippoAddressId("adr_123")).toBe(false);
    expect(isShippoAddressId("c".repeat(32))).toBe(true);
  });
});
