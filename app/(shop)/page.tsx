import Link from "next/link";
import { LogoMark } from "@/components/Brand";
import { CardBack } from "@/components/CardBack";
import { ShopUnavailable } from "@/components/ShopUnavailable";
import { Pack } from "@/components/Pack";
import { PageTitle, Stage } from "@/components/Stage";
import { doorSlug } from "@/lib/auth";
import { CATEGORIES, PUBLIC_CATEGORIES } from "@/lib/categories";
import { categoryStatus } from "@/lib/game/packs";
import { RULES_LINE } from "@/lib/game/rules";
import { recentWinner } from "@/lib/rosterRoll";
import { POKEROLL_URL } from "@/lib/rosterRollLink";
import { DraftWinner } from "./case/DraftWinner";

export const dynamic = "force-dynamic";

/**
 * Pokéroll's two ways to play, side by side: roll a starting lineup (pokeroll.fun, the daily free card) and roll a
 * pack (PUBLIC_CATEGORIES: Pokémon only for now). The rules sentence is here and on the pack screen, before anyone rolls.
 */
export default async function Home() {
  let items;
  try {
    items = await Promise.all(CATEGORIES.filter((c) => PUBLIC_CATEGORIES.includes(c.key)).map(async (c) => ({ ...c, ...(await categoryStatus(c.key)) })));
  } catch (e) {
    console.error("catalog query failed", e);
    return <ShopUnavailable />;
  }
  const winner = await recentWinner().catch(() => null);
  const door = doorSlug();
  return (
    <div className="relative space-y-8 pb-6">
      <PageTitle title="You roll it.">
        <p>Two ways to play. Real Pokémon cards either way.</p>
      </PageTitle>
      <ul className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-2">
        <li>
          <a href={POKEROLL_URL} className="group block">
            <Stage category="pokemon" className="flex aspect-[4/5] items-center justify-center rounded-2xl p-10">
              <div className="relative h-40 w-56 transition-transform duration-200 group-hover:-translate-y-1">
                {[-14, 0, 14].map((deg, i) => (
                  <CardBack
                    key={deg}
                    className="pack-shadow absolute left-1/2 top-0 w-24"
                    style={{ transform: `translateX(-50%) translateX(${(i - 1) * 46}px) rotate(${deg}deg)`, transformOrigin: "50% 100%" }}
                  />
                ))}
              </div>
            </Stage>
            <div className="pt-3 text-center">
              <h2 className="font-display text-xl text-navy">Roll a lineup</h2>
              <p className="mt-0.5 text-base text-navy/75">Draft your All-22. Daily winner gets a free Pokémon card.</p>
              <span className="btn-reveal mt-3 px-6 py-2.5 text-base">Roll</span>
            </div>
          </a>
        </li>
        {items.map((it) => (
          <li key={it.key}>
            <Link href={`/packs/${it.key}`} className="group block">
              <Stage category={it.key} className="flex aspect-[4/5] items-center justify-center rounded-2xl p-12">
                <div className={`w-36 transition-transform duration-200 group-hover:-translate-y-1 ${it.open ? "" : "opacity-50 grayscale"}`}>
                  <Pack category={it.key} />
                </div>
              </Stage>
              <div className="pt-3 text-center">
                <h2 className="font-display text-xl text-navy">Roll a {it.product.replace(/ Pack$/, " pack")}</h2>
                <p className="mt-0.5 text-base text-navy/75">{it.open ? "12 real cards. Keep it or put it back." : "Restocking. Check back soon."}</p>
                {it.open && <span className="btn-reveal mt-3 px-6 py-2.5 text-base">Roll a pack</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mx-auto max-w-lg text-center text-sm text-navy/70">{RULES_LINE}</p>
      <DraftWinner winner={winner} />
      {door && (
        <a href={`/${door}`} aria-label="Pokéroll" tabIndex={-1} className="absolute -bottom-3 -right-3 p-3 opacity-25">
          <LogoMark size={14} className="grayscale" />
        </a>
      )}
    </div>
  );
}
