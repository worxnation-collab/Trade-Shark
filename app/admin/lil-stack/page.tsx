import Link from "next/link";
import { artUrls, geminiConfigured } from "@/lib/brandArt";
import { CATEGORIES } from "@/lib/categories";
import { db } from "@/lib/db";
import { bins, categoryStatus, chaseList, STOCK } from "@/lib/game/packs";
import { sweepExpired } from "@/lib/game/play";
import { BIN, oddsLines, PRICES, SLOTS, TARGET } from "@/lib/game/rules";
import { money } from "@/lib/util";
import { CategoryPicker, ChaseToggle, LilStackTools } from "./LilStackTools";

export const metadata = { title: "Packs" };
export const dynamic = "force-dynamic";

const nameOf = (c: { game: string; name: string | null; player: string | null }) => (c.game === "Sports" ? c.player || c.name : c.name) || "Unnamed";
const SLOT_LABEL = { bulk: "bulk (under $0.25)", mid: "mid ($0.25–$0.75)", top: "top ($0.75–$2)" } as const;

/** The reveal game's packs, per category: bins, built packs by status, the chase list and its flag. */
export default async function PacksAdmin() {
  await sweepExpired();
  const [art, unsorted, perCat, charges] = await Promise.all([
    artUrls(),
    db.card.findMany({ where: { category: null, status: { in: STOCK }, readable: true }, orderBy: { createdAt: "asc" }, take: 60 }),
    Promise.all(
      CATEGORIES.map(async (cat) => {
        const [b, st, counts, chase, recent] = await Promise.all([
          bins(cat.key),
          categoryStatus(cat.key),
          db.gamePack.groupBy({ by: ["status"], where: { category: cat.key }, _count: true }),
          chaseList(cat.key),
          db.gamePack.findMany({
            where: { category: cat.key, status: { not: "dissolved" } },
            orderBy: [{ closedAt: { sort: "desc", nulls: "first" } }, { builtAt: "desc" }],
            take: 8,
            include: { cards: { select: { id: true, name: true, player: true, game: true, listPrice: true } } },
          }),
        ]);
        const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
        return { cat, b, st, count, chase, recent };
      }),
    ),
    db.gameCharge.groupBy({ by: ["kind"], where: { status: "succeeded" }, _sum: { amount: true }, _count: true }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Packs</h1>
        <p className="text-sm text-navy/70">
          The reveal game: {money(PRICES.reveal)} to see a pack, {money(PRICES.keepMore)} more to keep it ({money(PRICES.keepTotal)}), or a {money(PRICES.blind)} blind pack after a pass.
          Each pack is {SLOTS.bulk} bulk + {SLOTS.mid} mid + {SLOTS.top} top from one category, valued {money(TARGET.min)}–{money(TARGET.max)} by the existing engine prices.
          Packs are drawn ahead of time from stock; cards between {money(BIN.topTo)} and {money(BIN.chaseFrom)} stay in inventory.{" "}
          <Link href="/" className="font-semibold text-teal-2 underline" target="_blank">
            See the game
          </Link>
          .
        </p>
        {charges.length > 0 && (
          <p className="mt-1 text-xs text-navy/60">
            Taken so far: {charges.map((c) => `${c.kind} ${money(c._sum.amount ?? 0)} (${c._count})`).join(" · ")}
          </p>
        )}
      </div>

      <LilStackTools geminiReady={geminiConfigured()} art={art} />

      {perCat.map(({ cat, b, st, count, chase, recent }) => (
        <section key={cat.key} className="card space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-extrabold">{cat.product}</h2>
            <span className={`chip ${st.open ? "bg-teal/15 text-teal-2" : "bg-coral/15 text-coral"}`}>{st.open ? `Open · ${st.available} ready` : "Closed: no pack ready"}</span>
          </div>
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div>
              <h3 className="font-bold">Stock by bin</h3>
              <p>
                Bulk {b.bulk} · Mid {b.mid} · Top {b.top}
              </p>
              <p className="text-navy/60">
                $2–$9.99 (never packed) {b.between} · $10+ chase-priced {b.chase}
              </p>
              {b.short.length > 0 && (
                <p className="mt-1 text-coral">
                  Can&apos;t fill a pack: {b.short.map((x) => `${x.need - x.have} more ${SLOT_LABEL[x.slot]}`).join(", ")}.
                </p>
              )}
            </div>
            <div>
              <h3 className="font-bold">Built packs</h3>
              <p>
                Ready {count("available")} · Reserved {count("reserved")} · Kept {count("kept")} · Sold blind {count("sold-blind")} · Expired {count("expired")}
              </p>
            </div>
            <div>
              <h3 className="font-bold">Live odds</h3>
              <ul className="text-xs text-navy/70">
                {oddsLines(st.chaseOn).map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-lg bg-sand-2/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">Chase list ($10+) · {chase.length}</h3>
              <ChaseToggle category={cat.key} on={st.chaseOn} canTurnOn={chase.length > 0} />
            </div>
            <p className="text-xs text-navy/60">
              Off by default. When on, about 1 in 25 reservations (peek or blind, same roll) swaps the top slot for one of these, one chase pack reserved at a time.
              Only approved stock cards are eligible.
            </p>
            {chase.length > 0 && (
              <ul className="mt-2 divide-y divide-navy/5 text-sm">
                {chase.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2 py-1">
                    <Link href={`/admin/review/${c.id}`} className="truncate hover:text-teal-2">
                      {nameOf(c)} <span className="text-navy/50">· {c.setName}</span>
                    </Link>
                    <span className="shrink-0">
                      {money(c.listPrice)} · <span className={c.eligible ? "text-teal-2" : "text-navy/50"}>{c.eligible ? "eligible" : c.status}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {recent.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold">Recent packs</summary>
              <ul className="mt-2 space-y-2 text-xs">
                {recent.map((p) => {
                  const byId = new Map(p.cards.map((c) => [c.id, c]));
                  return (
                    <li key={p.id} className="rounded border border-navy/10 p-2">
                      <div className="font-semibold">
                        {p.status} · value {money(p.value)}
                        {p.chase && <span className="ml-1 text-coral">CHASE</span>}
                        {p.charged != null && ` · paid ${money(p.charged)}`} · <span className="text-navy/50">{p.id.slice(-6)}</span>
                      </div>
                      <div className="text-navy/60">
                        {p.cardIds
                          .map((id) => byId.get(id))
                          .filter(Boolean)
                          .map((c) => `${nameOf(c!)} ${money(c!.listPrice)}`)
                          .join(" · ") || "(cards back in stock)"}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </section>
      ))}

      {unsorted.length > 0 && (
        <section className="card p-4">
          <h2 className="font-bold">Unsorted</h2>
          <p className="mb-3 text-sm text-navy/70">Priced cards I couldn&apos;t place (basketball, Magic, or no team or league on it). They never go in a pack unless you pick a category.</p>
          <ul className="divide-y divide-navy/5 text-sm">
            {unsorted.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <Link href={`/admin/review/${c.id}`} className="min-w-0 flex-1 truncate hover:text-teal-2">
                  <strong>{nameOf(c)}</strong>{" "}
                  <span className="text-navy/60">
                    · {c.game}
                    {c.team ? ` · ${c.team}` : ""} · {money(c.listPrice)}
                  </span>
                </Link>
                <CategoryPicker cardId={c.id} value={null} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
