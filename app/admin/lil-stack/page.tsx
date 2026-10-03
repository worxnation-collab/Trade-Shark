import Link from "next/link";
import { EmptyState } from "@/components/SharkFin";
import { artUrls, geminiConfigured } from "@/lib/brandArt";
import { db } from "@/lib/db";
import { getFeatured, isFeatured } from "@/lib/featured";
import { LIL_STACK_SIZE, LIL_STACK_UNDER, PACK_MIN_PRICE, packLabel, packMath } from "@/lib/lilStack";
import { money } from "@/lib/util";
import { LilStackTools, PackActions } from "./LilStackTools";

export const metadata = { title: "Lil' Stack" };
export const dynamic = "force-dynamic";

export default async function LilStackAdmin() {
  const [packs, waiting, art, featured, sold] = await Promise.all([
    db.lilStack.findMany({
      where: { status: "open" },
      orderBy: [{ batch: { createdAt: "asc" } }, { seq: "asc" }],
      include: { batch: { select: { id: true, name: true } }, cards: { select: { id: true, name: true, player: true, game: true, setName: true, listPrice: true, frontImage: true } } },
    }),
    // Under $1 but not packed yet (e.g. repriced since the last build).
    db.card.count({ where: { status: { in: ["Priced", "BulkHold"] }, listPrice: { lt: LIL_STACK_UNDER }, lilStackId: null, readable: true } }),
    artUrls(),
    getFeatured(),
    db.lilStack.findMany({ where: { status: "sold" }, orderBy: { soldAt: "desc" }, take: 20, include: { batch: { select: { name: true } } } }),
  ]);
  const total = packs.reduce((n, p) => n + p.cards.length, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Lil&apos; Stack</h1>
          <p className="text-sm text-navy/70">
            Every card under {money(LIL_STACK_UNDER)} piles into a pack (up to {LIL_STACK_SIZE} per pack, one batch per pack), never a single.
            Opening is free; the whole pack sells on one Stripe link at the sum of its cards rounded up, minimum {money(PACK_MIN_PRICE)}. Shown at{" "}
            <Link href="/lil-stack" className="font-semibold text-teal-2 underline" target="_blank">
              /lil-stack
            </Link>
            .
          </p>
        </div>
        <div className="flex gap-3 text-center">
          <Stat n={total} label="cards in the pile" />
          <Stat n={packs.length} label={packs.length === 1 ? "pack" : "packs"} />
          <Stat n={waiting} label="waiting to pack" warn={waiting > 0} />
        </div>
      </div>

      <LilStackTools waiting={waiting} geminiReady={geminiConfigured()} art={art} />

      {packs.length === 0 ? (
        <EmptyState title="No Lil' Stacks yet">Process a batch: cards priced under {money(LIL_STACK_UNDER)} pile up here automatically.</EmptyState>
      ) : (
        packs.map((p, i) => {
          const byId = new Map(p.cards.map((c) => [c.id, c]));
          const cards = p.cardIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
          return (
            <section key={p.id} className="card p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-bold">
                  {packLabel(i + 1)} <span className="text-sm font-normal text-navy/60">· {cards.length} cards</span>
                  {p.price != null && <span className="ml-2 text-base text-teal-2">{packMath(cards.length, p.paymentLinkAmount ?? p.price)}</span>}
                </h2>
                <Link href={`/admin/batches/${p.batch.id}`} className="text-sm text-teal-2 underline">
                  {p.batch.name} · pack {p.seq}
                </Link>
              </div>
              <PackActions
                id={p.id}
                linkUrl={p.paymentLinkActive ? p.paymentLinkUrl : null}
                linkError={p.linkError}
                featured={isFeatured(featured, "stack", p.id)}
                price={p.paymentLinkAmount ?? p.price}
              />
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-12">
                {cards.map((c) => (
                  <li key={c.id}>
                    <Link href={`/admin/review/${c.id}`} className="block">
                      {c.frontImage && <img src={`/api/admin/images/${c.frontImage}`} alt="" className="aspect-[5/7] w-full rounded object-cover" loading="lazy" />}
                      <span className="mt-1 block truncate text-xs font-semibold">{(c.game === "Sports" ? c.player || c.name : c.name) || "Unnamed"}</span>
                      <span className="block text-xs text-navy/60">{money(c.listPrice)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      <SoldList sold={sold} />
    </div>
  );
}

function SoldList({ sold }: { sold: { id: string; cardIds: string[]; soldPrice: number | null; soldAt: Date | null; stripeSessionId: string | null; batch: { name: string } }[] }) {
  if (!sold.length) return null;
  return (
    <section className="card p-4">
      <h2 className="mb-2 font-bold">Sold stacks</h2>
      <ul className="divide-y divide-navy/5 text-sm">
        {sold.map((p) => (
          <li key={p.id} className="flex flex-wrap justify-between gap-2 py-1.5">
            <span>
              {p.batch.name} · {p.cardIds.length} cards
            </span>
            <span className="text-navy/60">
              {money(p.soldPrice)} · {p.stripeSessionId ? "Stripe" : "by hand"} · {p.soldAt?.toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>
    </section>
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
