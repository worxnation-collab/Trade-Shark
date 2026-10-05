import Link from "next/link";
import { EmptyState } from "@/components/SharkFin";
import { artUrls, geminiConfigured } from "@/lib/brandArt";
import { CATEGORIES, productName } from "@/lib/categories";
import { db } from "@/lib/db";
import { PACK_SIZE, PACKABLE, packLabel, packMath } from "@/lib/lilStack";
import { money } from "@/lib/util";
import { CategoryPicker, LilStackTools, PackActions } from "./LilStackTools";

export const metadata = { title: "Packs" };
export const dynamic = "force-dynamic";

const nameOf = (c: { game: string; name: string | null; player: string | null }) => (c.game === "Sports" ? c.player || c.name : c.name) || "Unnamed";

/** Every pack by category, with the cards inside, each card's value, and the pay link. Plus stock waiting to fill one. */
export default async function PacksAdmin() {
  const cardSel = { id: true, name: true, player: true, game: true, setName: true, team: true, listPrice: true, frontImage: true } as const;
  const [packs, stock, unsorted, art, sold] = await Promise.all([
    db.lilStack.findMany({ where: { status: "open", category: { not: null } }, orderBy: { seq: "asc" }, include: { cards: { select: cardSel } } }),
    db.card.groupBy({ by: ["category"], where: { status: { in: PACKABLE.filter((s) => s !== "LilStack") }, lilStackId: null, readable: true, category: { not: null } }, _count: true, _sum: { listPrice: true } }),
    db.card.findMany({
      where: { category: null, status: { in: PACKABLE }, readable: true },
      select: { ...cardSel, categorySource: true },
      orderBy: { createdAt: "asc" },
      take: 60,
    }),
    artUrls(),
    db.lilStack.findMany({ where: { status: "sold" }, orderBy: { soldAt: "desc" }, take: 20 }),
  ]);
  const waitingAll = stock.reduce((n, s) => n + s._count, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Packs</h1>
          <p className="text-sm text-navy/70">
            The shop sells three products: {CATEGORIES.map((c) => c.product).join(", ")}. A pack is exactly {PACK_SIZE} cards of one category, oldest cards
            first, priced at the sum of its cards. Cards stay in stock until there are {PACK_SIZE} to fill a pack.{" "}
            <Link href="/" className="font-semibold text-teal-2 underline" target="_blank">
              See the shop
            </Link>
            .
          </p>
        </div>
        <div className="flex gap-3 text-center">
          <Stat n={packs.length} label={packs.length === 1 ? "pack for sale" : "packs for sale"} />
          <Stat n={waitingAll} label="cards in stock" />
          <Stat n={unsorted.length} label="unsorted" warn={unsorted.length > 0} />
        </div>
      </div>

      <LilStackTools geminiReady={geminiConfigured()} art={art} />

      {CATEGORIES.map((cat) => {
        const mine = packs.filter((p) => p.category === cat.key);
        const st = stock.find((s) => s.category === cat.key);
        const waiting = st?._count ?? 0;
        return (
          <section key={cat.key} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-extrabold">{cat.product}</h2>
              <p className="text-sm text-navy/60">
                {mine.length} pack{mine.length === 1 ? "" : "s"} · {waiting} in stock ({money(st?._sum.listPrice ?? 0)})
                {` · ${PACK_SIZE - (waiting % PACK_SIZE)} more to fill the next pack`}
              </p>
            </div>
            {mine.length === 0 ? (
              <EmptyState title={`No ${cat.product}s yet`}>Packs fill automatically once {PACK_SIZE} {cat.name} cards are identified and priced.</EmptyState>
            ) : (
              mine.map((p, i) => {
                const byId = new Map(p.cards.map((c) => [c.id, c]));
                const cards = p.cardIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
                const value = cards.reduce((n, c) => n + (c.listPrice ?? 0), 0);
                return (
                  <div key={p.id} className="card p-4">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-lg font-bold">
                        {packLabel(cat.key, i + 1)} <span className="text-sm font-normal text-navy/60">· {cards.length} cards</span>
                        <span className="ml-2 text-base text-teal-2">{packMath(cards.length, p.paymentLinkAmount ?? p.price ?? value)}</span>
                      </h3>
                      <span className="text-xs text-navy/50">pack id {p.id.slice(-6)} · #{p.seq}</span>
                    </div>
                    <PackActions id={p.id} linkUrl={p.paymentLinkActive ? p.paymentLinkUrl : null} linkError={p.linkError} price={p.paymentLinkAmount ?? p.price} />
                    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-12">
                      {cards.map((c) => (
                        <li key={c.id}>
                          <Link href={`/admin/review/${c.id}`} className="block">
                            {c.frontImage && <img src={`/api/admin/images/${c.frontImage}`} alt="" className="aspect-[5/7] w-full rounded object-cover" loading="lazy" />}
                            <span className="mt-1 block truncate text-xs font-semibold">{nameOf(c)}</span>
                            <span className="block text-xs text-navy/60">{money(c.listPrice)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </section>
        );
      })}

      {unsorted.length > 0 && (
        <section className="card p-4">
          <h2 className="font-bold">Unsorted</h2>
          <p className="mb-3 text-sm text-navy/70">
            Priced cards I couldn&apos;t place (basketball, Magic, or a sports card with no team or league on it). They stay in inventory and never go in a pack unless
            you pick a category.
          </p>
          <ul className="divide-y divide-navy/5 text-sm">
            {unsorted.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <Link href={`/admin/review/${c.id}`} className="min-w-0 flex-1 truncate hover:text-teal-2">
                  <strong>{nameOf(c)}</strong> <span className="text-navy/60">· {c.game}{c.team ? ` · ${c.team}` : ""}{c.setName ? ` · ${c.setName}` : ""} · {money(c.listPrice)}</span>
                </Link>
                <CategoryPicker cardId={c.id} value={null} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {sold.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 font-bold">Sold packs</h2>
          <ul className="divide-y divide-navy/5 text-sm">
            {sold.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>
                  {p.category ? productName(p.category) : "Lil' Stack (old)"} · {p.cardIds.length} cards
                </span>
                <span className="text-navy/60">
                  {money(p.soldPrice)} · {p.stripeSessionId ? "Stripe" : "by hand"} · {p.soldAt?.toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return (
    <div className={`card min-w-24 px-3 py-2 ${warn ? "ring-2 ring-coral/50" : ""}`}>
      <div className="text-2xl font-extrabold">{n}</div>
      <div className="text-xs text-navy/60">{label}</div>
    </div>
  );
}
