import Link from "next/link";
import { EmptyState } from "@/components/SharkFin";
import { db } from "@/lib/db";
import { SHIP_LABEL, type ShipMethod } from "@/lib/shipping";
import { cardLabel } from "@/lib/shop";
import { productName } from "@/lib/categories";
import { money, safeJson } from "@/lib/util";
import { ShipForm } from "./ShipForm";

export const metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

interface Order {
  kind: "card" | "stack" | "game";
  id: string;
  title: string;
  href: string;
  soldAt: Date | null;
  merch: number | null;
  shipping: number | null;
  method: string | null;
  channel: string | null;
  shipTo: { name?: string | null; email?: string | null; address?: Record<string, string | null> } | null;
  tracking: string | null;
  shippedAt: Date | null;
}

/** Sold packs (and any older sold singles), unshipped first. */
export default async function OrdersPage() {
  const [cards, packs, games] = await Promise.all([
    // A card sold inside a pack belongs to the pack's order.
    db.card.findMany({
      where: { status: "Sold", gamePackId: null, OR: [{ lilStackId: null }, { lilStack: { status: { not: "sold" } } }] },
      orderBy: { soldAt: "desc" },
      take: 200,
    }),
    db.lilStack.findMany({ where: { status: "sold" }, orderBy: { soldAt: "desc" }, take: 200, include: { batch: { select: { name: true } } } }),
    db.gamePack.findMany({ where: { status: { in: ["kept", "sold-blind"] } }, orderBy: { closedAt: "desc" }, take: 200 }),
  ]);
  const orders: Order[] = [
    ...cards.map((c) => ({
      kind: "card" as const,
      id: c.id,
      title: cardLabel(c),
      href: `/admin/review/${c.id}`,
      soldAt: c.soldAt,
      merch: c.soldPrice,
      shipping: c.shippingCharged,
      method: c.shipMethod,
      channel: c.soldChannel,
      shipTo: safeJson<Order["shipTo"]>(c.shipTo ?? "null", null),
      tracking: c.trackingNumber,
      shippedAt: c.shippedAt,
    })),
    ...packs.map((p) => ({
      kind: "stack" as const,
      id: p.id,
      title: `${p.category ? productName(p.category) : `Lil' Stack${p.batch ? ` (${p.batch.name})` : ""}`} · ${p.cardIds.length} cards`,
      href: `/admin/lil-stack`,
      soldAt: p.soldAt,
      merch: p.soldPrice,
      shipping: p.shippingCharged,
      method: p.shipMethod,
      channel: p.stripeSessionId ? "stripe" : "local",
      shipTo: safeJson<Order["shipTo"]>(p.shipTo ?? "null", null),
      tracking: p.trackingNumber,
      shippedAt: p.shippedAt,
    })),
    ...games.map((p) => ({
      kind: "game" as const,
      id: p.id,
      title: `${productName(p.category)} · ${p.status === "kept" ? "kept after reveal" : "blind"} · 12 cards`,
      href: `/admin/lil-stack`,
      soldAt: p.closedAt,
      merch: p.charged,
      shipping: null, // the game prices don't add a shipping line
      method: "bubble",
      channel: "game",
      shipTo: safeJson<Order["shipTo"]>(p.shipTo ?? "null", null),
      tracking: p.trackingNumber,
      shippedAt: p.shippedAt,
    })),
  ].sort((a, b) => Number(!!a.shippedAt) - Number(!!b.shippedAt) || (b.soldAt?.getTime() ?? 0) - (a.soldAt?.getTime() ?? 0));
  const toShip = orders.filter((o) => !o.shippedAt).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Orders</h1>
        <p className="text-sm text-navy/70">
          {toShip} to ship · {orders.length} sold. Bubble mailers need a tracking number; stamped envelopes have none.
        </p>
      </div>
      {orders.length === 0 ? (
        <EmptyState title="No orders yet">Sold packs land here with their shipping method.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {orders.map((o) => {
            const method = o.method === "pwe" || o.method === "bubble" ? (o.method as ShipMethod) : null;
            const a = o.shipTo?.address;
            return (
              <li key={`${o.kind}-${o.id}`} className={`card grid gap-3 p-4 md:grid-cols-[1.4fr_1fr_1.3fr] ${o.shippedAt ? "opacity-70" : ""}`}>
                <div>
                  <Link href={o.href} className="font-semibold hover:text-teal-2">
                    {o.title}
                  </Link>
                  <div className="text-xs text-navy/60">
                    {o.soldAt?.toLocaleDateString()} · {o.channel === "stripe" ? "Stripe" : (o.channel ?? "by hand")}
                  </div>
                  <div className="mt-1 text-sm">
                    {o.kind === "card" ? "Card" : "Cards"} {money(o.merch)} · Shipping {o.shipping == null ? "—" : o.shipping === 0 ? "free" : money(o.shipping)}
                  </div>
                </div>
                <div className="text-sm">
                  <span className={`chip ${method === "bubble" ? "bg-teal/15 text-teal-2" : method === "pwe" ? "bg-sand-2 text-navy/70" : "bg-navy/5 text-navy/50"}`}>
                    {method ? SHIP_LABEL[method] : "Method not recorded"}
                  </span>
                  {o.shipTo && (
                    <address className="mt-1 text-xs not-italic text-navy/70">
                      {o.shipTo.name}
                      {a && (
                        <>
                          <br />
                          {[a.line1, a.line2].filter(Boolean).join(", ")}
                          <br />
                          {[a.city, a.state, a.postal_code].filter(Boolean).join(" ")}
                        </>
                      )}
                    </address>
                  )}
                </div>
                <div>
                  {o.shippedAt ? (
                    <p className="text-sm">
                      Shipped {o.shippedAt.toLocaleDateString()}
                      {o.tracking ? (
                        <>
                          {" "}
                          · <span className="font-mono">{o.tracking}</span>
                        </>
                      ) : method === "pwe" ? (
                        " · no tracking"
                      ) : null}
                    </p>
                  ) : (
                    <ShipForm kind={o.kind} id={o.id} pwe={method === "pwe"} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
