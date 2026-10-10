import Link from "next/link";
import { EmptyState } from "@/components/Brand";
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
    // Bought game packs not in a parcel: stored in the player's Collection until they tap Ship (not mine to ship yet).
    db.gamePack.findMany({ where: { status: { in: ["kept", "sold-blind"] }, orderId: null }, orderBy: { closedAt: "desc" }, take: 500, select: { id: true } }),
  ]);
  const parcels = await db.shipOrder.findMany({
    orderBy: [{ shippedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: 200,
    include: { packs: { select: { id: true, number: true, category: true, kind: true, status: true } }, vaultItems: { select: { id: true, name: true, condition: true } }, buyer: { select: { email: true } } },
  });
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
      <section className="space-y-3">
        <h2 className="text-lg font-bold">
          Parcels <span className="text-sm font-normal text-navy/60">· {parcels.filter((o) => !o.shippedAt).length} to ship · USPS Ground Advantage, 6×4 in</span>
        </h2>
        <p className="text-xs text-navy/60">
          {games.length} bought pack{games.length === 1 ? "" : "s"} stored in players&apos; collections, not shipping yet. A parcel shows up here when a player taps Ship.
        </p>
        {parcels.length === 0 ? (
          <p className="text-sm text-navy/60">No game orders yet.</p>
        ) : (
          <ul className="space-y-3">
            {parcels.map((o) => {
              const to = safeJson<{ name?: string; address?: { line1?: string; line2?: string; city?: string; state?: string; postal?: string } }>(o.shipTo, {});
              const names = [...o.packs.map((p) => `Pack ${p.number ?? "?"}`), ...o.vaultItems.map((v) => v.name)].join(", ");
              return (
                <li key={o.id} className={`card grid gap-3 p-4 md:grid-cols-[1.4fr_1fr_1.3fr] ${o.shippedAt ? "opacity-70" : ""}`}>
                  <div>
                    <div className="font-semibold">
                      {o.packs.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 && ", "}
                          <Link href={`/admin/packs/${p.id}`} className="hover:text-teal-2">
                            {productName(p.category)} {p.number ?? "?"}
                          </Link>
                          {p.kind !== "base" && <span className="ml-1 text-xs text-coral">{p.kind.toUpperCase()}</span>}
                        </span>
                      ))}
                      {o.vaultItems.map((v, i) => (
                        <span key={v.id}>
                          {(i > 0 || o.packs.length > 0) && ", "}
                          {v.name} <span className="text-xs text-navy/60">({v.condition}, vault single)</span>
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-navy/60">
                      {o.createdAt.toLocaleString()} · {o.packs.length} pack{o.packs.length === 1 ? "" : "s"}
                      {o.vaultItems.length > 0 && ` + ${o.vaultItems.length} single${o.vaultItems.length === 1 ? "" : "s"}`} · one parcel
                    </div>
                    <div className="mt-1 text-sm">
                      Shipping paid {money(o.shippingCharged)}
                      {o.how === "credit" ? " (member mailer credit)" : o.how === "fallback" ? " (no Shippo rate: flat $5.95)" : ""}
                      {o.labelCost != null && <span className="text-navy/60"> · label {money(o.labelCost)}</span>}
                    </div>
                  </div>
                  <address className="text-xs not-italic text-navy/70">
                    {to.name}
                    <br />
                    {[to.address?.line1, to.address?.line2].filter(Boolean).join(", ")}
                    <br />
                    {[to.address?.city, to.address?.state, to.address?.postal].filter(Boolean).join(" ")}
                    <br />
                    {o.buyer.email}
                  </address>
                  <div className="space-y-1.5 text-sm">
                    {o.labelPath ? (
                      <a href={`/api/admin/orders/${o.id}/label`} target="_blank" rel="noreferrer" className="btn-primary inline-block">
                        Print {names}
                      </a>
                    ) : (
                      <form action={`/api/admin/orders/${o.id}/buy-label`} method="post">
                        <button className="btn-coral">Buy label for {names}</button>
                      </form>
                    )}
                    {o.labelError && !o.labelPath && <p className="text-xs text-coral">{o.labelError}</p>}
                    {o.trackingCode && (
                      <p className="text-xs">
                        Tracking{" "}
                        <a href={o.trackingUrl ?? "#"} target="_blank" rel="noreferrer" className="font-mono underline">
                          {o.trackingCode}
                        </a>
                        {o.emailedAt ? " · emailed" : o.emailError ? ` · not emailed: ${o.emailError}` : ""}
                      </p>
                    )}
                    {o.shippedAt ? (
                      <p>Dropped off {o.shippedAt.toLocaleDateString()}</p>
                    ) : (
                      o.labelPath && <ShipForm kind="parcel" id={o.id} pwe />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <h2 className="pt-2 text-lg font-bold">Older orders</h2>
      {orders.length === 0 ? (
        <EmptyState title="No older orders">Single cards and packs sold before the reveal game land here.</EmptyState>
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
