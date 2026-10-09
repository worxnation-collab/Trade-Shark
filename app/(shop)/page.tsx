import Link from "next/link";
import { SharkFin } from "@/components/SharkFin";
import { ShopUnavailable } from "@/components/ShopUnavailable";
import { Pack } from "@/components/Pack";
import { PageTitle, Stage } from "@/components/Stage";
import { doorSlug } from "@/lib/auth";
import { CATEGORIES, PUBLIC_CATEGORIES } from "@/lib/categories";
import { categoryStatus } from "@/lib/game/packs";
import { RULES_LINE } from "@/lib/game/rules";

export const dynamic = "force-dynamic";

/** The public packs (PUBLIC_CATEGORIES: Pokémon only for now) on their stages. The rules sentence is here and on the pack screen, before anyone looks (navy on sand, never on a stage). */
export default async function Home() {
  let items;
  try {
    items = await Promise.all(CATEGORIES.filter((c) => PUBLIC_CATEGORIES.includes(c.key)).map(async (c) => ({ ...c, ...(await categoryStatus(c.key)) })));
  } catch (e) {
    console.error("catalog query failed", e);
    return <ShopUnavailable />;
  }
  const door = doorSlug();
  return (
    <div className="relative space-y-10 pb-6">
      <PageTitle title={items.length === 1 ? "Open a pack." : "Pick a pack."}>
        <p>{RULES_LINE}</p>
        <p className="mt-2 text-sm font-normal text-navy/65">Every pack is 12 real cards from my shop.</p>
      </PageTitle>
      <ul className={items.length === 1 ? "mx-auto max-w-sm" : "grid gap-6 sm:grid-cols-3"}>
        {items.map((it) => (
          <li key={it.key}>
            <Link href={`/packs/${it.key}`} className="group block">
              <Stage category={it.key} className="flex aspect-[4/5] items-center justify-center rounded-lg p-12">
                <div className={`w-36 transition-transform duration-200 group-hover:-translate-y-1 ${it.open ? "" : "opacity-50 grayscale"}`}>
                  <Pack category={it.key} />
                </div>
              </Stage>
              <div className="pt-3 text-center">
                <h2 className="font-display text-xl text-navy">{it.product}</h2>
                <p className="mt-0.5 text-base text-navy/75">{it.open ? "Looking is free." : "Restocking. Check back soon."}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {door && (
        <a href={`/${door}`} aria-label="Trade Shark" tabIndex={-1} className="absolute -bottom-3 -right-3 p-3 opacity-25">
          <SharkFin size={14} mono className="text-navy" />
        </a>
      )}
    </div>
  );
}
