import Link from "next/link";
import { Disclaimer } from "@/components/Disclaimer";
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
    <section className="-mx-4 -my-8 bg-navy px-4 py-10 text-sand sm:mx-0 sm:my-0 sm:rounded-2xl sm:px-8">
      <div className="text-center">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-teal">My shop, your packs</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Collection</h1>
      </div>
      {!buyer ? (
        <p className="mt-8 text-center text-sm text-sand/75">
          Your packs show up here once you play.{" "}
          <Link href="/play/card" className="underline">
            Save a card to start
          </Link>
          .
        </p>
      ) : (
        <Collection packs={packs} order={CATEGORIES.map((c) => c.key)} address={shipFields(buyer)} />
      )}
      <Disclaimer dark className="mx-auto mt-10 max-w-md text-center" />
    </section>
  );
}
