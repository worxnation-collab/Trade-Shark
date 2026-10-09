import { currentBuyer } from "@/lib/game/buyer";
import { cleanAddress, quoteShipment } from "@/lib/game/ship";
import { json, play } from "../../_util";

export const runtime = "nodejs";

/** Collection → Ship, step 1: the address they confirmed and the packs and vault singles they picked → one rate for one parcel. */
export const POST = play(async (req: Request) => {
  const buyer = await currentBuyer();
  if (!buyer) return json({ ok: false, error: "Save a card to play." }, 401);
  const body = (await req.json().catch(() => ({}))) as { packIds?: unknown; vaultIds?: unknown; address?: Record<string, unknown> };
  const packIds = Array.isArray(body.packIds) ? body.packIds.map(String).slice(0, 100) : [];
  const vaultIds = Array.isArray(body.vaultIds) ? body.vaultIds.map(String).slice(0, 100) : [];
  const address = body.address ? cleanAddress(body.address) : null;
  if (body.address && !address) return json({ ok: false, error: "Fill in your name and full US address." }, 400);
  const r = await quoteShipment(buyer, packIds, address, vaultIds);
  return json(r, r.ok ? 200 : 400);
});
