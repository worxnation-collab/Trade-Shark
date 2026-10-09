import Link from "next/link";
import { Disclaimer } from "@/components/Disclaimer";
import { PageTitle } from "@/components/Stage";
import { CATEGORIES, productName } from "@/lib/categories";
import { currentBuyer } from "@/lib/game/buyer";
import { collection, shipFields } from "@/lib/game/ship";
import { creditBalance, vaultItems } from "@/lib/game/vault";
import { getSettings } from "@/lib/settings";
import { Collection, type StoredPack, type VaultSingle } from "./Collection";

export const dynamic = "force-dynamic";
export const metadata = { title: "My collection · Trade Shark" };

/** Every pack the player bought, by category, and every prize single in their vault. Nothing ships until they choose to. */
export default async function CollectionPage() {
  const buyer = await currentBuyer();
  const packs: StoredPack[] = buyer
    ? (await collection(buyer.id)).map((p) => ({
        id: p.id,
        category: p.category,
        product: productName(p.category),
        number: p.number,
        at: (p.closedAt ?? new Date()).toISOString(),
        how: p.status === "kept" ? "Kept" : "Blind pack",
        state: !p.orderId ? "stored" : p.order?.shippedAt || p.order?.labelPath ? "shipped" : "shipping",
        tracking: p.order?.trackingUrl ?? null,
      }))
    : [];
  const [vault, credit, settings] = buyer ? await Promise.all([vaultItems(buyer.id), creditBalance(buyer.id), getSettings()]) : [[], 0, null];
  const singles: VaultSingle[] = vault
    .filter((v) => v.status !== "cancelled")
    .map((v) => ({
      id: v.id,
      name: v.name,
      condition: v.condition,
      value: v.value,
      at: v.wonAt.toISOString(),
      how: v.source === "roster-roll" ? `Pokéroll winner${v.sourceRef ? ` · ${v.sourceRef}` : ""}` : "Prize",
      status: v.status as VaultSingle["status"],
      tracking: v.order?.trackingUrl ?? null,
    }));
  return (
    <section>
      <PageTitle title="Collection" />
      {!buyer ? (
        <p className="mt-8 rounded-lg border border-navy/15 bg-white p-10 text-center text-base text-navy/80">
          Your packs and prizes show up here once you have one.{" "}
          <Link href="/" className="underline">
            Have a look
          </Link>
          .
        </p>
      ) : (
        <Collection packs={packs} singles={singles} credit={credit} sellBackPct={settings?.sellBackPct ?? 80} order={CATEGORIES.map((c) => c.key)} address={shipFields(buyer)} />
      )}
      <Disclaimer className="mx-auto mt-10 max-w-md text-center" />
    </section>
  );
}
