import Link from "next/link";
import { ShopUnavailable } from "@/components/ShopUnavailable";
import { HeaderBand, Stage } from "@/components/Stage";
import { ACCENT, headerArt, packStill, titleArt } from "@/lib/brandAssets";
import { CATEGORIES } from "@/lib/categories";
import { categoryStatus } from "@/lib/game/packs";
import { RULES_LINE } from "@/lib/game/rules";

export const dynamic = "force-dynamic";

/** Pick a category. The rules sentence is here and on the pack screen, before any payment (on cream, never on art). */
export default async function Home() {
  let items;
  try {
    items = await Promise.all(CATEGORIES.map(async (c) => ({ ...c, ...(await categoryStatus(c.key)) })));
  } catch (e) {
    console.error("catalog query failed", e);
    return <ShopUnavailable />;
  }
  const title = titleArt("pick");
  return (
    <div className="space-y-8">
      <div>
        <HeaderBand art={headerArt("packs")}>
          <h1 className="text-center">
            {title ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={title} alt="Pick a pack." className="mx-auto w-[min(88vw,520px)] -rotate-2 drop-shadow-[0_6px_0_rgba(11,31,58,0.55)]" />
            ) : (
              <span className="text-4xl font-black tracking-tight text-sand sm:text-6xl">Pick a pack.</span>
            )}
          </h1>
        </HeaderBand>
        <p className="mx-auto mt-5 max-w-lg text-center text-lg font-extrabold leading-snug text-navy">{RULES_LINE}</p>
        <p className="mx-auto mt-2 max-w-md text-center text-sm text-navy/65">Every pack is 12 real cards from my shop. You see all 12 before you decide to keep it.</p>
      </div>
      <ul className="grid gap-5 sm:grid-cols-3">
        {items.map((it) => (
          <li key={it.key}>
            <Link href={`/packs/${it.key}`} className="card lift group block overflow-hidden border-2 border-navy">
              <Stage category={it.key} className="flex aspect-[4/5] items-center justify-center p-8">
                <div className={`w-40 transition-transform duration-200 group-hover:-translate-y-1 group-hover:rotate-1 ${it.open ? "" : "opacity-50 grayscale"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={packStill(it.key)} alt="" className="clip-soft w-full drop-shadow-[0_14px_18px_rgba(0,0,0,0.55)]" />
                </div>
              </Stage>
              <div className="flex items-center justify-between gap-2 border-t-4 p-4" style={{ borderColor: ACCENT[it.key] }}>
                <div>
                  <h2 className="text-xl font-black uppercase tracking-wide">{it.product}</h2>
                  <p className="mt-0.5 text-sm font-semibold text-navy/70">{it.open ? "$1 to reveal" : "Restocking. Check back soon."}</p>
                </div>
                {it.open && (
                  <span className="rounded-full bg-navy px-3 py-1 text-xs font-black uppercase tracking-wider text-gold group-hover:bg-navy-2">Open</span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
