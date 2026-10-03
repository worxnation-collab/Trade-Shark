import Link from "next/link";
import { CssPack } from "@/components/PackArt";
import { EmptyState } from "@/components/SharkFin";
import { ShopUnavailable } from "@/components/ShopUnavailable";
import { homeFeed, type HomeItem } from "@/lib/home";
import { packMath } from "@/lib/lilStack";
import { checkoutLine, SHIP_LABEL } from "@/lib/shipping";
import { money } from "@/lib/util";

export const dynamic = "force-dynamic";

/** $4 for a whole-dollar pack price, $12.50 otherwise. */
const price = (n: number | null) => (n == null ? "" : Number.isInteger(n) ? `$${n}` : money(n));

/**
 * Home: the most eye-catching live item first (pin, then wow score, never price), then "On the hunt".
 * The full grid with price sorting lives at /shop.
 */
export default async function Home() {
  let feed;
  try {
    feed = await homeFeed();
  } catch (e) {
    console.error("home query failed", e);
    return <ShopUnavailable />;
  }
  const { hero, hunt } = feed;
  if (!hero)
    return (
      <EmptyState title="The case is empty right now">
        Fresh cards land here as soon as they&apos;re ready. Check back soon, or{" "}
        <Link href="/lil-stack" className="font-semibold text-teal-2 underline">
          take a bite of a Lil&apos; Stack
        </Link>
        .
      </EmptyState>
    );

  return (
    <div className="space-y-10">
      <Hero item={hero} />

      {hunt.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xl font-extrabold tracking-tight">On the hunt</h2>
            <Link href="/shop" className="text-sm font-semibold text-teal-2 hover:underline">
              Whole shop →
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {hunt.map((it) => (
              <li key={`${it.kind}-${it.id}`}>
                <Link href={it.href} className="card lift group block overflow-hidden">
                  <div className="relative aspect-[5/7] bg-navy">
                    {it.kind === "card" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.image} alt={it.name} className="h-full w-full object-contain" loading="lazy" />
                    ) : (
                      <div className="flex h-full items-center justify-center p-5">
                        {it.art ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.art} alt="" className="w-full rounded" />
                        ) : (
                          <CssPack />
                        )}
                      </div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <div className="truncate text-sm font-semibold group-hover:text-teal-2">{it.name}</div>
                    <div className="flex justify-between gap-2 text-xs text-navy/55">
                      <span className="truncate">{it.setLine}</span>
                      <span className="shrink-0">{price(it.price)}</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/shop" className="btn-ghost px-5 py-2.5">
          Browse every card
        </Link>
        <Link href="/lil-stack" className="btn-ghost px-5 py-2.5">
          Lil&apos; Stack: take a bite
        </Link>
      </div>
    </div>
  );
}

function Hero({ item }: { item: HomeItem }) {
  const stack = item.kind === "stack";
  return (
    <section className="-mx-4 -mt-8 overflow-hidden bg-navy px-4 py-10 text-sand sm:mx-0 sm:mt-0 sm:rounded-2xl sm:px-10">
      <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex justify-center">
          {item.kind === "card" ? (
            <Link href={item.href} className="block w-64 sm:w-80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image}
                alt={item.name}
                className="w-full -rotate-2 rounded-xl shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.08)] transition-transform duration-300 hover:rotate-0"
              />
            </Link>
          ) : (
            <div className="flex flex-col items-center gap-5">
              <div className="w-40">{item.art ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={item.art} alt="" className="w-full rounded-lg" /> : <CssPack />}</div>
              {/* Every card in the stack, face up: you see exactly what you're buying. */}
              <ul className="flex flex-wrap justify-center gap-1.5" aria-label={`Inside ${item.name}`}>
                {item.cards.map((c, i) => (
                  <li key={c.id} className="w-12 sm:w-14" style={{ transform: `rotate(${(i % 2 ? 1 : -1) * 3}deg)` }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/shop/image/${c.id}/front`} alt={c.name} title={c.name} className="aspect-[5/7] w-full rounded object-cover shadow" loading="lazy" />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="text-center md:text-left">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-teal">{stack ? "Lil' Stack" : "Top of the case"}</p>
          <h1 className="mt-2 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">{item.name}</h1>
          {item.setLine && <p className="mt-1 text-sand/70">{item.setLine}</p>}
          <p className="mt-4 text-lg font-semibold text-teal">{item.hype}</p>
          {item.price != null && (
            <p className="mt-5 text-sm font-semibold text-sand/85">
              {checkoutLine(item.price, item.ship, stack ? "Cards" : "Card")}
              <span className="block text-xs font-normal text-sand/55">
                {item.ship.free ? `Free ${item.ship.label.toLowerCase()}` : item.ship.label}
                {item.ship.label === SHIP_LABEL.pwe ? ", no tracking" : ", ships from Florida"}
              </span>
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 md:justify-start">
            {item.buyUrl ? (
              <a href={item.buyUrl} className="btn-coral px-6 py-3 text-base" data-pop>
                {stack ? "Buy this stack" : "Buy this card"} · {price(item.price)}
              </a>
            ) : (
              <Link href={item.href} className="btn-coral px-6 py-3 text-base" data-pop>
                Buy this card · {price(item.price)}
              </Link>
            )}
            <Link href={item.href} className="text-sm font-semibold text-sand/80 underline-offset-4 hover:text-white hover:underline">
              {stack ? "Tear it open first" : "Details"}
            </Link>
          </div>
          {item.kind === "stack" && item.price != null && <p className="mt-2 text-sm text-sand/60">{packMath(item.cards.length, item.price)}</p>}
        </div>
      </div>
    </section>
  );
}
