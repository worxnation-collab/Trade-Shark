import { db } from "@/lib/db";
import { consignOpen, founderSummary, holdBin, recordMissingSales, reserveNow, senderSummary, accountStatus } from "@/lib/partners";
import { money } from "@/lib/util";
import { AddSender, ConsignLock, OwnerActions, SubmissionActions } from "./PartnerActions";

export const metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

/** Founders, consignment senders, and the reserve that stands behind consignment cards. Every payout is by hand. */
export default async function PayoutsPage() {
  await recordMissingSales().catch((e) => console.error("catch-up settlement failed", e));
  const [open, reserve, founders, senders, hold, subs, ledger] = await Promise.all([
    consignOpen(),
    reserveNow(),
    founderSummary(),
    senderSummary(),
    holdBin(),
    db.consignSubmission.findMany({ where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.reserveEntry.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
  ]);
  const status = await Promise.all([...founders, ...senders].map((r) => (r.stripeAccountId ? accountStatus(r.stripeAccountId) : null)));
  const untagged = await db.card.count({ where: { partnerId: null, senderId: null, status: { in: ["Inbox", "Identified", "Priced", "BulkHold", "NeedsLook"] } } });
  const recent = await db.partnerEarning.findMany({ orderBy: { createdAt: "desc" }, take: 12 });
  const held = hold.filter((c) => c.held);
  const acct = (i: number, id: string | null) => {
    const st = status[i];
    if (!id) return "No connected Stripe account yet.";
    if (!st) return id;
    if ("error" in st) return `${id} · ${st.error}`;
    return `${id} · ${st.transfers === "active" ? "ready for transfers" : `transfers ${st.transfers}${st.detailsSubmitted ? "" : ", onboarding not finished"}`}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Payouts</h1>
        <p className="text-sm text-navy/70">
          Founders split a sold pack (the amount actually charged: keep $3.99 / $4.99 / $5.99 by look, or blind $6.99, minus the Stripe fee and any stamp credit) by engine value. A consignment card takes no share: its sender is owed that
          card&apos;s engine price, paid from the reserve. Memberships are company money and fill the reserve; shipping pays the label. Looking is free; unsold cards and packs put back pay
          nothing. Every payout is a manual Stripe Connect transfer.
        </p>
        {untagged > 0 && <p className="mt-2 rounded bg-coral/10 p-2 text-sm text-coral">{untagged} card(s) in stock have no owner and can&apos;t go in a pack. Tag them on their batch page.</p>}
      </div>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card p-4">
          <h2 className="font-bold">Consignment reserve</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-navy/60">Reserve on hand</dt>
              <dd className="text-xl font-extrabold">{money(reserve.onHand)}</dd>
            </div>
            <div>
              <dt className="text-navy/60">Reserved (unsold consignment)</dt>
              <dd className="text-xl font-extrabold">{money(reserve.liability)}</dd>
            </div>
            <div>
              <dt className="text-navy/60">Shortfall</dt>
              <dd className={`text-xl font-extrabold ${reserve.shortfall > 0 ? "text-coral" : ""}`}>{money(reserve.shortfall)}</dd>
            </div>
            <div>
              <dt className="text-navy/60">Payable to senders</dt>
              <dd className="font-semibold">{money(reserve.payable)}</dd>
            </div>
            <div>
              <dt className="text-navy/60">Consignment in built stacks</dt>
              <dd className="font-semibold">{money(reserve.committed)}</dd>
            </div>
            <div>
              <dt className="text-navy/60">Largest consignment card that can be packed today</dt>
              <dd className="text-xl font-extrabold text-teal-2">{open ? money(reserve.headroom) : "— (locked)"}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-navy/60">
            Filled only by company money: memberships, the company&apos;s part of sold packs, and founder shares retained here. A stack is built with consignment cards only
            if the reserve covers all of them together.
          </p>
        </div>
        <ConsignLock open={open} />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">Founders</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {founders.map((r, i) => (
            <div key={r.id} className="card space-y-3 p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-bold">{r.name}</h3>
                <span className="text-2xl font-extrabold text-teal-2">{money(r.payable)}</span>
              </div>
              <p className="-mt-2 text-right text-xs text-navy/60">payable</p>
              <Figures r={r} sold={`${r.packsSold} packs`} reservedLabel="Retained in reserve" />
              <p className="text-xs text-navy/60">Stripe {acct(i, r.stripeAccountId)}</p>
              <OwnerActions kind="founder" id={r.id} name={r.name} payable={r.payable} accountId={r.stripeAccountId} canPay />
              <Payouts list={r.payouts} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
          Consignment senders {!open && <span className="chip bg-navy/10 text-navy/70">locked</span>}
        </h2>
        {senders.length === 0 ? (
          <p className="text-sm text-navy/60">No senders yet.{open ? "" : " Senders can be added once consignment is unlocked."}</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {senders.map((r, i) => (
              <div key={r.id} className="card space-y-3 p-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-lg font-bold">{r.name}</h3>
                  <span className="text-2xl font-extrabold text-teal-2">{money(r.payable)}</span>
                </div>
                <p className="-mt-2 text-right text-xs text-navy/60">payable</p>
                <Figures r={r} sold={`${r.cardsSold} cards`} reservedLabel="Reserved (unsold)" />
                <p className="text-xs text-navy/60">Stripe {acct(founders.length + i, r.stripeAccountId)}</p>
                <OwnerActions kind="sender" id={r.id} name={r.name} payable={r.payable} accountId={r.stripeAccountId} canPay={open} />
                <Payouts list={r.payouts} />
              </div>
            ))}
          </div>
        )}
        {open && <AddSender />}
      </section>

      <section className="card p-4">
        <h2 className="font-bold">Hold bin · consignment cards the reserve can&apos;t cover yet</h2>
        {held.length === 0 ? (
          <p className="text-sm text-navy/60">Nothing on hold.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-navy/60">
              <tr>
                <th>Card</th>
                <th>Owed to</th>
                <th className="text-right">Card price</th>
                <th className="text-right">Reserve on hand</th>
                <th className="text-right">Shortfall</th>
              </tr>
            </thead>
            <tbody>
              {held.map((c) => (
                <tr key={c.id} className="border-t border-navy/5">
                  <td>
                    <a href={`/admin/review/${c.id}`} className="hover:text-teal-2">
                      {c.player || c.name || "card"}
                    </a>
                  </td>
                  <td>{c.owedTo}</td>
                  <td className="text-right">{money(c.listPrice)}</td>
                  <td className="text-right">{money(c.onHand)}</td>
                  <td className="text-right font-semibold text-coral">{money(c.shortfall)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card p-4">
        <h2 className="font-bold">Consignment requests {!open && <span className="text-sm font-normal text-navy/60">· can&apos;t be accepted while locked</span>}</h2>
        {subs.length === 0 ? (
          <p className="text-sm text-navy/60">No requests.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {subs.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-navy/5 pt-2">
                <span>
                  <b>{s.name}</b> · {s.email} · {s.createdAt.toLocaleDateString()}
                  <br />
                  <span className="text-navy/70">{s.about}</span>
                </span>
                <SubmissionActions id={s.id} canAccept={open} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="font-bold">Recent founder splits</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-navy/60">No sold packs yet.</p>
          ) : (
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-navy/60">
                <tr>
                  <th>Pack</th>
                  <th>Founder</th>
                  <th className="text-right">Net</th>
                  <th className="text-right">Value</th>
                  <th className="text-right">Owed</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => (
                  <tr key={e.id} className="border-t border-navy/5">
                    <td>
                      <a href={`/admin/packs/${e.packId}`} className="hover:text-teal-2">
                        {e.saleKind === "kept" ? "keep" : "blind"} {money(e.packPrice)}
                      </a>
                    </td>
                    <td>{founders.find((f) => f.id === e.partnerId)?.name ?? e.partnerId}</td>
                    <td className="text-right">
                      {money(e.net)}
                      {e.feeEstimated && <span title="Fee estimated">*</span>}
                    </td>
                    <td className="text-right">
                      {money(e.cardValue)} / {money(e.packValue)}
                    </td>
                    <td className="text-right font-semibold">{money(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card p-4">
          <h2 className="font-bold">Reserve ledger</h2>
          {ledger.length === 0 ? (
            <p className="text-sm text-navy/60">Nothing in yet. Peeks, memberships and sold packs add to it.</p>
          ) : (
            <ul className="mt-2 space-y-0.5 text-xs">
              {ledger.map((e) => (
                <li key={e.id} className="flex justify-between border-t border-navy/5 pt-0.5">
                  <span>
                    {e.createdAt.toLocaleString()} · {e.kind}
                    {e.note ? ` · ${e.note}` : ""}
                  </span>
                  <span className={e.amount < 0 ? "text-coral" : ""}>{money(e.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Figures({ r, sold, reservedLabel }: { r: { uploaded: number; readyValue: number; readyCards: number; soldValue: number; reserved: number; payable: number }; sold: string; reservedLabel: string }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
      <dt className="text-navy/60">Cards uploaded</dt>
      <dd className="text-right font-semibold">{r.uploaded}</dd>
      <dt className="text-navy/60">In ready stacks</dt>
      <dd className="text-right font-semibold">
        {money(r.readyValue)} <span className="text-xs font-normal text-navy/50">({r.readyCards})</span>
      </dd>
      <dt className="text-navy/60">Value sold</dt>
      <dd className="text-right font-semibold">
        {money(r.soldValue)} <span className="text-xs font-normal text-navy/50">({sold})</span>
      </dd>
      <dt className="text-navy/60">{reservedLabel}</dt>
      <dd className="text-right">{money(r.reserved)}</dd>
      <dt className="text-navy/60">Payable</dt>
      <dd className="text-right font-semibold">{money(r.payable)}</dd>
    </dl>
  );
}

function Payouts({ list }: { list: { id: string; createdAt: Date; amount: number; status: string; transferId: string | null; error: string | null }[] }) {
  if (!list.length) return null;
  return (
    <ul className="space-y-0.5 border-t border-navy/10 pt-2 text-xs text-navy/70">
      {list.map((p) => (
        <li key={p.id}>
          {p.createdAt.toLocaleDateString()} · {money(p.amount)} ·{" "}
          {p.status === "paid" ? `paid (${p.transferId})` : p.status === "retained" ? "kept in reserve" : p.status === "failed" ? <span className="text-coral">failed: {p.error}</span> : "pending"}
        </li>
      ))}
    </ul>
  );
}
