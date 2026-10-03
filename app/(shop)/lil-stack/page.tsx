import { artUrls } from "@/lib/brandArt";
import { publicPacks } from "@/lib/lilStack";
import { LilStackPack } from "./LilStackPack";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lil' Stack · Take a bite" };

/**
 * Free packs of my under-$1 cards. Nothing to buy: tearing a pack open only shows what's already in it.
 * Reads cards through publicPacks() (front, name, set: never price, cost or Stripe ids).
 */
export default async function LilStackPage() {
  const [packs, art] = await Promise.all([publicPacks(), artUrls().catch(() => ({}))]);
  return (
    <section className="-mx-4 -my-8 bg-navy px-4 py-10 text-sand sm:mx-0 sm:my-0 sm:rounded-2xl sm:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-teal">Lil&apos; Stack</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Take a bite.</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-sand/75">
          My under-a-dollar cards, piled into free packs. Nothing to buy here. Tear one open and see what&apos;s inside.
        </p>
      </div>
      <LilStackPack packs={packs} art={art} />
    </section>
  );
}
