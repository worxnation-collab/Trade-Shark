import Link from "next/link";
import { ShopUnavailable } from "@/components/ShopUnavailable";
import { PageTitle, Stage } from "@/components/Stage";
import { packStill } from "@/lib/brandAssets";
import { CATEGORIES } from "@/lib/categories";
import { categoryStatus } from "@/lib/game/packs";
import { RULES_LINE } from "@/lib/game/rules";

export const dynamic = "force-dynamic";

/** Pick a category. The rules sentence is here and on the pack screen, before any payment (navy on cream, never on art). */
export default async function Home() {
  let items;
  try {
    items = await Promise.all(CATEGORIES.map(async (c) => ({ ...c, ...(await categoryStatus(c.key)) })));
  } catch (e) {
    console.error("catalog query failed", e);
    return <ShopUnavailable />;
  }
  return (
    <div className="space-y-10">
      <PageTitle title="Pick a pack.">
        <p>{RULES_LINE}</p>
        <p className="mt-2 text-sm font-normal text-navy/65">Every pack is 12 real cards from my shop. You see all 12 before you decide to keep it.</p>
      </PageTitle>
      <ul className="grid gap-6 sm:grid-cols-3">
        {items.map((it) => (
          <li key={it.key}>
            <Link href={`/packs/${it.key}`} className="group block">
              <Stage category={it.key} className="flex aspect-[4/5] items-center justify-center rounded-lg border-b-2 border-gold p-12">
                <div className={`w-36 transition-transform duration-200 group-hover:-translate-y-1 ${it.open ? "" : "opacity-50 grayscale"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={packStill(it.key)} alt="" className="pack-shadow w-full" />
                </div>
              </Stage>
              <div className="pt-3 text-center">
                <h2 className="text-xl font-extrabold text-navy">{it.product}</h2>
                <p className="mt-0.5 text-base text-navy/75">{it.open ? "$1 to reveal." : "Restocking. Check back soon."}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
