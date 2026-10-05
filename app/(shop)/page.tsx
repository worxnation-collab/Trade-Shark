import Link from "next/link";
import { CssPack } from "@/components/PackArt";
import { ShopUnavailable } from "@/components/ShopUnavailable";
import { artUrls } from "@/lib/brandArt";
import { CATEGORIES } from "@/lib/categories";
import { categoryStatus } from "@/lib/game/packs";
import { RULES_LINE } from "@/lib/game/rules";

export const dynamic = "force-dynamic";

/** Pick a category. The rules sentence is here and on the pack screen, before any payment. */
export default async function Home() {
  let items, art: { closed?: string };
  try {
    [items, art] = await Promise.all([Promise.all(CATEGORIES.map(async (c) => ({ ...c, ...(await categoryStatus(c.key)) }))), artUrls().catch(() => ({}))]);
  } catch (e) {
    console.error("catalog query failed", e);
    return <ShopUnavailable />;
  }
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Pick a pack.</h1>
        <p className="mx-auto mt-3 max-w-lg font-semibold text-navy/80">{RULES_LINE}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-navy/60">Every pack is 12 real cards from my shop. You see all 12 before you decide to keep it.</p>
      </div>
      <ul className="grid gap-5 sm:grid-cols-3">
        {items.map((it) => (
          <li key={it.key}>
            <Link href={`/packs/${it.key}`} className="card lift group block overflow-hidden">
              <div className="flex aspect-[4/5] items-center justify-center bg-navy p-8">
                <div className={`w-40 ${it.open ? "" : "opacity-50"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {art.closed ? <img src={art.closed} alt="" className="w-full rounded-lg shadow-2xl" /> : <CssPack />}
                </div>
              </div>
              <div className="p-4">
                <h2 className="text-xl font-extrabold">{it.product}</h2>
                <p className="mt-1 text-sm text-navy/70">{it.open ? "$1 to reveal" : "Restocking. Check back soon."}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
