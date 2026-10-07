import Link from "next/link";
import { Disclaimer } from "@/components/Disclaimer";
import { HeaderBand } from "@/components/Stage";
import { headerArt, patternArt } from "@/lib/brandAssets";
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
      <HeaderBand art={headerArt("collection")}>
        <h1 className="-rotate-1 rounded-xl border-4 border-sand bg-navy px-5 py-2 text-4xl font-black uppercase tracking-tight text-sand shadow-[5px_5px_0_#d9a441] sm:text-5xl">
          Collection
        </h1>
      </HeaderBand>
      {!buyer ? (
        <p className="pattern-band mt-8 rounded-2xl p-10 text-center text-sm font-semibold text-navy/80" style={patternArt() ? { backgroundImage: `url(${patternArt()})` } : undefined}>
          Your packs show up here once you play.{" "}
          <Link href="/play/card" className="underline">
            Save a card to start
          </Link>
          .
        </p>
      ) : (
        <Collection packs={packs} order={CATEGORIES.map((c) => c.key)} address={shipFields(buyer)} pattern={patternArt()} />
      )}
      <Disclaimer className="mx-auto mt-10 max-w-md text-center" />
    </section>
  );
}
