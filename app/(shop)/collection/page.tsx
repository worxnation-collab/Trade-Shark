import Link from "next/link";
import { Disclaimer } from "@/components/Disclaimer";
import { PageTitle } from "@/components/Stage";
import { CATEGORIES, productName } from "@/lib/categories";
import { currentBuyer } from "@/lib/game/buyer";
import { collection, shipFields } from "@/lib/game/ship";
import { Collection, type StoredPack } from "./Collection";

export const dynamic = "force-dynamic";
export const metadata = { title: "My collection · Trade Shark" };

/** Every pack the player bought, by category. Packs stay here until they choose to ship them. */
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
  return (
    <section>
      <PageTitle title="Collection" />
      {!buyer ? (
        <p className="mt-8 rounded-lg border border-navy/15 bg-white p-10 text-center text-base text-navy/80">
          Your packs show up here once you play.{" "}
          <Link href="/play/card" className="underline">
            Save a card to start
          </Link>
          .
        </p>
      ) : (
        <Collection packs={packs} order={CATEGORIES.map((c) => c.key)} address={shipFields(buyer)} />
      )}
      <Disclaimer className="mx-auto mt-10 max-w-md text-center" />
    </section>
  );
}
