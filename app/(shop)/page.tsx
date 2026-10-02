import Link from "next/link";
import { EmptyState, SharkFin } from "@/components/SharkFin";
import { ShopUnavailable } from "@/components/ShopUnavailable";
import { db } from "@/lib/db";
import { cardLabel, PUBLIC_CARD_SELECT } from "@/lib/shop";
import { FOR_SALE } from "@/lib/types";
import { money } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ game?: string; q?: string }> }) {
  const { game, q } = await searchParams;
  let cards;
  try {
    cards = await db.card.findMany({
    where: {
      status: { in: FOR_SALE },
      listPrice: { not: null },
      frontImage: { not: null },
      readable: true,
      ...(game ? { game } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { player: { contains: q, mode: "insensitive" } }, { setName: { contains: q, mode: "insensitive" } }] } : {}),
    },
    select: PUBLIC_CARD_SELECT,
    orderBy: { updatedAt: "desc" },
    take: 200,
    });
  } catch (e) {
    console.error("shop query failed", e);
    return <ShopUnavailable />;
  }
  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-navy px-6 py-8 text-sand">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Singles from the Trade Shark case</h1>
            <p className="mt-1 text-sand/80">Every photo is the actual card you get. Pay securely, ships from Florida with tracking.</p>
          </div>
          <SharkFin size={56} className="hidden shrink-0 sm:block" />
        </div>
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
        <EmptyState title={q || game ? "Nothing matches that search" : "The case is empty right now"}>
          {q || game ? "Try a shorter name or another game." : "Fresh cards land here as soon as they're ready. Check back soon."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((c) => (
            <Link key={c.id} href={`/card/${c.id}`} className="card lift group overflow-hidden">
              <div className="relative aspect-[5/7] bg-sand-2">
                {c.paymentLinkActive && c.paymentLinkUrl && (
                  <span className="chip absolute left-2 top-2 bg-coral text-white shadow">Buy now</span>
                )}
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
