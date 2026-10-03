import { Disclaimer } from "@/components/Disclaimer";
import { artUrls } from "@/lib/brandArt";
import { publicPacks, type PackSort } from "@/lib/lilStack";
import { LilStackPack } from "./LilStackPack";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lil' Stack · Take a bite" };

const SORTS: Record<PackSort, string> = { default: "Newest packs", "price-asc": "Price: low to high", "price-desc": "Price: high to low" };

/**
 * Packs of my under-$1 cards. Opening one is free and shows every card; only then does Buy this stack appear.
 * Reads cards through publicPacks() (front, name, set). Sold packs aren't listed.
 */
export default async function LilStackPage({ searchParams }: { searchParams: Promise<{ sort?: string; pack?: string }> }) {
  const { sort: sortParam, pack } = await searchParams;
  const sort = (sortParam && sortParam in SORTS ? sortParam : "default") as PackSort;
  const [packs, art] = await Promise.all([publicPacks(sort), artUrls().catch(() => ({}))]);
  return (
    <section className="-mx-4 -my-8 bg-navy px-4 py-10 text-sand sm:mx-0 sm:my-0 sm:rounded-2xl sm:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-teal">Lil&apos; Stack</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Take a bite.</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-sand/75">
          My under-a-dollar cards, piled into packs. Tearing one open is free and shows every card. Like what you see? Buy the whole stack.
        </p>
        {packs.length > 1 && (
          <form className="mt-4 flex justify-center gap-2">
            <select name="sort" defaultValue={sort} className="input max-w-[12rem] text-navy" aria-label="Pack order">
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button className="btn-ghost">Sort</button>
          </form>
        )}
      </div>
      <LilStackPack key={sort} packs={packs} art={art} startId={pack} />
      <Disclaimer dark className="mx-auto mt-10 max-w-md text-center" />
    </section>
  );
}
