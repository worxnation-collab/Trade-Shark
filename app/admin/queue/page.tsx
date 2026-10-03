import Link from "next/link";
import { EmptyState } from "@/components/SharkFin";
import { db } from "@/lib/db";
import { AUTO_PUBLISH_MAX } from "@/lib/publish";
import { cardLabel } from "@/lib/shop";
import { money } from "@/lib/util";
import { LiveRow, LookRow } from "./QueueRows";

export const metadata = { title: "Needs a look" };
export const dynamic = "force-dynamic";

/**
 * The one queue. Everything $5 and under already went live on upload; this is only:
 * cards priced over $5, cards whose pay link failed, and cards I pulled. Plus the shop, with a Pull button.
 */
export default async function QueuePage() {
  const [look, held, live] = await Promise.all([
    db.card.findMany({
      where: { status: { in: ["NeedsLook", "Pulled"] } },
      orderBy: [{ suggestedPrice: { sort: "desc", nulls: "last" } }, { listPrice: "desc" }],
      include: { runs: { where: { source: "stripe", status: "error" }, orderBy: { at: "desc" }, take: 1 } },
    }),
    db.card.count({ where: { status: "Inbox" } }),
    db.card.findMany({ where: { status: { in: ["Ready", "Listed"] } }, orderBy: { updatedAt: "desc" }, take: 200 }),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Needs a look</h1>
        <p className="text-sm text-navy/70">
          Cards priced over {money(AUTO_PUBLISH_MAX)} wait here. Everything at {money(AUTO_PUBLISH_MAX)} and under is already on the shop.
          {held > 0 && (
            <>
              {" "}
              <Link href="/admin/cards?status=Inbox" className="font-semibold text-coral underline">
                {held} card{held === 1 ? "" : "s"} held
              </Link>{" "}
              because they couldn&apos;t be identified.
            </>
          )}
        </p>
      </div>

      {look.length === 0 ? (
        <EmptyState title="Nothing needs a look">Fresh uploads at {money(AUTO_PUBLISH_MAX)} and under go straight to the shop.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {look.map((c) => (
            <LookRow
              key={c.id}
              card={{
                id: c.id,
                name: c.player || c.name || "",
                label: cardLabel(c),
                image: c.frontImage,
                price: c.listPrice,
                suggested: c.suggestedPrice,
                source: c.suggestedSource,
                status: c.status,
                note: c.holdReason === "rotation" ? "Rotation: still sideways after auto-rotate. Turn it, then approve." : (c.runs[0]?.reason ?? (c.holdReason ? `Waiting: ${c.holdReason}` : null)),
                rotation: c.holdReason === "rotation",
                v: c.updatedAt.getTime(),
              }}
            />
          ))}
        </ul>
      )}

      <section>
        <h2 className="mb-2 text-lg font-bold">
          On the shop <span className="text-sm font-normal text-navy/60">· {live.length}</span>
        </h2>
        {live.length === 0 ? (
          <p className="text-sm text-navy/60">Nothing live yet.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {live.map((c) => (
              <LiveRow key={c.id} card={{ id: c.id, label: cardLabel(c), image: c.frontImage, price: c.listPrice, v: c.updatedAt.getTime() }} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
