import Link from "next/link";
import { EmptyState } from "@/components/SharkFin";
import { db } from "@/lib/db";
import { cardLabel } from "@/lib/shop";
import { FOR_SALE } from "@/lib/types";
import { money } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ game?: string; q?: string }> }) {
  const { game, q } = await searchParams;
  const cards = await db.card.findMany({
    where: {
      status: { in: FOR_SALE },
      listPrice: { not: null },
      frontImage: { not: null },
      readable: true,
      ...(game ? { game } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { player: { contains: q, mode: "insensitive" } }, { setName: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-navy px-6 py-8 text-sand">
        <h1 className="text-3xl font-extrabold tracking-tight">Singles from the Trade Shark case</h1>
        <p className="mt-1 text-sand/80">Scan it. Price it. List it. Every photo is the actual card you get.</p>
        <form className="mt-5 flex flex-wrap gap-2">
          <input name="q" defaultValue={q} placeholder="Search name, player, set" className="input max-w-xs text-navy" />
          <select name="game" defaultValue={game ?? ""} className="input max-w-[10rem] text-navy">
            <option value="">All games</option>
            <option>Pokemon</option>
            <option>Magic</option>
            <option>Sports</option>
            <option>Other</option>
          </select>
          <button className="btn-primary">Search</button>
        </form>
      </section>
      {cards.length === 0 ? (
        <EmptyState title="The case is empty right now">New cards land here as soon as they're priced. Check back soon.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((c) => (
            <Link key={c.id} href={`/card/${c.id}`} className="card group overflow-hidden">
              <div className="aspect-[5/7] bg-sand-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/shop/image/${c.id}/front`} alt={cardLabel(c)} className="h-full w-full object-contain" loading="lazy" />
              </div>
              <div className="space-y-1 p-3">
                <div className="line-clamp-2 text-sm font-semibold group-hover:text-teal">{cardLabel(c)}</div>
                <div className="flex items-center justify-between text-xs text-navy/60">
                  <span>{c.graded || c.condition}{c.variant ? ` · ${c.variant}` : ""}</span>
                  <span className="text-base font-bold text-navy">{money(c.listPrice)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
