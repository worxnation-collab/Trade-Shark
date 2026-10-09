"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function useCall() {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  async function call(path: string, body: unknown, what: string) {
    setBusy(what);
    setMsg("");
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || r.statusText);
      return j;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy("");
      router.refresh();
    }
  }
  return { busy, msg, setMsg, call };
}

export function OwnerActions({ kind, id, name, payable, accountId, canPay }: { kind: "founder" | "sender"; id: string; name: string; payable: number; accountId: string | null; canPay: boolean }) {
  const { busy, msg, setMsg, call } = useCall();
  const [link, setLink] = useState("");
  const [acct, setAcct] = useState(accountId ?? "");
  const base = `/api/admin/payouts/${kind}/${id}`;
  async function pay() {
    if (!confirm(`Transfer $${payable.toFixed(2)} to ${name}'s Stripe account now?`)) return;
    const j = await call(`${base}/pay`, {}, "pay");
    if (j) setMsg(`Sent $${j.amount.toFixed(2)} (${j.transferId}).`);
  }
  async function retain() {
    if (!confirm(`Keep ${name}'s $${payable.toFixed(2)} in the business as reserve money instead of paying it out?`)) return;
    const j = await call(`${base}/retain`, {}, "retain");
    if (j) setMsg(`$${j.amount.toFixed(2)} kept in the reserve.`);
  }
  return (
    <div className="space-y-2">
      <button className="btn-coral w-full justify-center" disabled={!!busy || !canPay || payable < 0.01 || !accountId} onClick={pay}>
        {busy === "pay" ? "Sending…" : canPay ? `Pay ${name} $${payable.toFixed(2)}` : "Payouts locked"}
      </button>
      {kind === "founder" && (
        <button className="btn-ghost w-full justify-center py-1 text-xs" disabled={!!busy || payable < 0.01} onClick={retain}>
          {busy === "retain" ? "Moving…" : "Keep it in the reserve instead"}
        </button>
      )}
      {canPay && (
        <details className="text-xs">
          <summary className="cursor-pointer text-navy/60">Stripe account</summary>
          <div className="mt-2 space-y-2">
            <button
              className="btn-ghost w-full justify-center py-1"
              disabled={!!busy}
              onClick={async () => {
                const j = await call(`${base}/connect`, {}, "link");
                if (j?.url) setLink(j.url);
              }}
            >
              {busy === "link" ? "Making link…" : accountId ? "New onboarding link" : "Create account + onboarding link"}
            </button>
            {link && (
              <p className="break-all">
                Send this to {name}:{" "}
                <a href={link} target="_blank" rel="noreferrer" className="underline">
                  {link}
                </a>
              </p>
            )}
            <div className="flex gap-1">
              <input className="input flex-1 py-1 text-xs" placeholder="or paste acct_…" value={acct} onChange={(e) => setAcct(e.target.value)} />
              <button className="btn-ghost py-1" disabled={!!busy || acct === (accountId ?? "")} onClick={() => call(`${base}/connect`, { accountId: acct }, "save")}>
                Save
              </button>
            </div>
          </div>
        </details>
      )}
      {msg && <p className="text-xs text-navy/70">{msg}</p>}
    </div>
  );
}

/** The public consignment lock. Locked by default: Coming soon page, no requests, no sender tags, no sender payouts. */
export function ConsignLock({ open }: { open: boolean }) {
  const { busy, msg, call } = useCall();
  async function flip() {
    const to = !open;
    if (to && !confirm("Unlock consignment? The public page starts taking requests, sender tags and sender payouts turn on.")) return;
    await call("/api/admin/payouts/lock", { open: to }, "lock");
  }
  return (
    <div className={`card space-y-2 p-4 ${open ? "border-coral" : ""}`}>
      <h2 className="font-bold">Public consignment page</h2>
      <p className="text-sm">
        {open ? (
          <span className="font-semibold text-coral">Unlocked: taking requests.</span>
        ) : (
          <span className="font-semibold">Locked: /consign shows Coming soon.</span>
        )}
      </p>
      <p className="text-xs text-navy/60">Locked: no public requests, no accepting senders, no consignment tags, no sender payouts. Locking again pulls consignment cards out of ready stacks.</p>
      <button className={open ? "btn-dark" : "btn-ghost"} disabled={!!busy} onClick={flip}>
        {busy ? "Saving…" : open ? "Lock it" : "Unlock"}
      </button>
      <a href="/consign" target="_blank" className="block text-xs underline">
        See the public page
      </a>
      {msg && <p className="text-xs text-coral">{msg}</p>}
    </div>
  );
}

export function AddSender() {
  const { busy, msg, call } = useCall();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <input className="input w-48 py-1" placeholder="Sender name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input w-56 py-1" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="btn-ghost py-1" disabled={!!busy || !name.trim()} onClick={() => call("/api/admin/payouts/senders", { name, email }, "add")}>
        Add sender
      </button>
      {msg && <span className="text-xs text-coral">{msg}</span>}
    </div>
  );
}

export function SubmissionActions({ id, canAccept }: { id: string; canAccept: boolean }) {
  const { busy, msg, call } = useCall();
  return (
    <span className="flex items-center gap-2">
      <button className="btn-primary py-1" disabled={!!busy || !canAccept} onClick={() => call(`/api/admin/payouts/submissions/${id}`, { action: "accept" }, "a")} title={canAccept ? "" : "Consignment is locked"}>
        Accept
      </button>
      <button className="btn-ghost py-1" disabled={!!busy} onClick={() => call(`/api/admin/payouts/submissions/${id}`, { action: "decline" }, "d")}>
        Decline
      </button>
      {msg && <span className="text-xs text-coral">{msg}</span>}
    </span>
  );
}
