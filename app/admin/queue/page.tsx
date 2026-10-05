import Link from "next/link";
import { EmptyState } from "@/components/SharkFin";
import { db } from "@/lib/db";
import { AUTO_PUBLISH_MAX } from "@/lib/publish";
import { cardLabel } from "@/lib/shop";
import { money } from "@/lib/util";
import { LookRow } from "./QueueRows";

export const metadata = { title: "Needs a look" };
export const dynamic = "force-dynamic";

/**
 * The one queue. Everything $5 and under already went to stock for packing; this is only:
 * cards priced over $5, sideways scans, the same scan twice, and cards I pulled.
 */
export default async function QueuePage() {
  const [look, held] = await Promise.all([
    db.card.findMany({
      where: { status: { in: ["NeedsLook", "Pulled"] } },
      orderBy: [{ suggestedPrice: { sort: "desc", nulls: "last" } }, { listPrice: "desc" }],
      include: { runs: { where: { source: "stripe", status: "error" }, orderBy: { at: "desc" }, take: 1 } },
    }),
    db.card.count({ where: { status: "Inbox" } }),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Needs a look</h1>
        <p className="text-sm text-navy/70">
          Cards priced over {money(AUTO_PUBLISH_MAX)} wait here. Approve one and it joins its category&apos;s next pack. Everything at{" "}
          {money(AUTO_PUBLISH_MAX)} and under already did.
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
        <EmptyState title="Nothing needs a look">Fresh uploads at {money(AUTO_PUBLISH_MAX)} and under go straight to stock for packing.</EmptyState>
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

    </div>
  );
}
