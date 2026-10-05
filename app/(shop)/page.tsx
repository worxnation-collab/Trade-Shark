import Link from "next/link";
import { CssPack } from "@/components/PackArt";
import { ShopUnavailable } from "@/components/ShopUnavailable";
import { artUrls } from "@/lib/brandArt";
import { catalog } from "@/lib/lilStack";
import { money } from "@/lib/util";

export const dynamic = "force-dynamic";

const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : money(n));

/** The whole catalog: three products, Baseball Pack, Football Pack, Pokemon Pack. */
export default async function Home() {
  let items, art: { closed?: string };
  try {
    [items, art] = await Promise.all([catalog(), artUrls().catch(() => ({}))]);
  } catch (e) {
    console.error("catalog query failed", e);
    return <ShopUnavailable />;
  }
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Pick a pack.</h1>
        <p className="mx-auto mt-3 max-w-md text-navy/70">Every pack is 12 real cards from my shop. Open it for free, see all 12, then decide.</p>
      </div>
      <ul className="grid gap-5 sm:grid-cols-3">
        {items.map((it) => (
          <li key={it.key}>
            <Link href={`/packs/${it.key}`} className="card lift group block overflow-hidden">
              <div className="flex aspect-[4/5] items-center justify-center bg-navy p-8">
                <div className={`w-40 ${it.packs ? "" : "opacity-50"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {art.closed ? <img src={art.closed} alt="" className="w-full rounded-lg shadow-2xl" /> : <CssPack />}
                </div>
              </div>
              <div className="p-4">
                <h2 className="text-xl font-extrabold">{it.product}</h2>
                <p className="mt-1 text-sm text-navy/70">
                  {it.packs === 0
                    ? "Restocking. Check back soon."
                    : `${it.packs} pack${it.packs === 1 ? "" : "s"} · ${it.low === it.high ? usd(it.low!) : `${usd(it.low!)}–${usd(it.high!)}`} + shipping`}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
