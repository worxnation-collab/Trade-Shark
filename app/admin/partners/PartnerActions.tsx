"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PartnerActions({ id, name, owed, accountId }: { id: string; name: string; owed: number; accountId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [link, setLink] = useState("");
  const [acct, setAcct] = useState(accountId ?? "");

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

  async function pay() {
    if (!confirm(`Transfer $${owed.toFixed(2)} to ${name}'s Stripe account now?`)) return;
    const j = await call(`/api/admin/partners/${id}/pay`, {}, "pay");
    if (j) setMsg(`Sent $${j.amount.toFixed(2)} (${j.transferId}).`);
  }

  return (
    <div className="space-y-2">
      <button className="btn-coral w-full justify-center" disabled={!!busy || owed < 0.01 || !accountId} onClick={pay}>
        {busy === "pay" ? "Sending…" : `Pay ${name} $${owed.toFixed(2)}`}
      </button>
      <details className="text-xs">
        <summary className="cursor-pointer text-navy/60">Stripe account</summary>
        <div className="mt-2 space-y-2">
          <button
            className="btn-ghost w-full justify-center py-1"
            disabled={!!busy}
            onClick={async () => {
              const j = await call(`/api/admin/partners/${id}/connect`, {}, "link");
              if (j?.url) setLink(j.url);
            }}
          >
            {busy === "link" ? "Making link…" : accountId ? "New onboarding link" : "Create account + onboarding link"}
          </button>
          {link && (
            <p className="break-all">
              Send this to {name}: <a href={link} target="_blank" rel="noreferrer" className="underline">{link}</a>
            </p>
          )}
          <div className="flex gap-1">
            <input className="input flex-1 py-1 text-xs" placeholder="or paste acct_…" value={acct} onChange={(e) => setAcct(e.target.value)} />
            <button className="btn-ghost py-1" disabled={!!busy || acct === (accountId ?? "")} onClick={() => call(`/api/admin/partners/${id}/connect`, { accountId: acct }, "save")}>
              Save
            </button>
          </div>
        </div>
      </details>
      {msg && <p className="text-xs text-navy/70">{msg}</p>}
    </div>
  );
}
