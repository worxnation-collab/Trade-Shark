"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PartnerSelect } from "@/components/PartnerSelect";

/** Whose batch this is. Tags every untagged card in it, so they can enter the bins. */
export function BatchPartner({ batchId, value, untagged }: { batchId: string; value: string | null; untagged: number }) {
  const router = useRouter();
  const [v, setV] = useState(value ?? "");
  const [msg, setMsg] = useState("");
  async function save() {
    setMsg("Saving…");
    const r = await fetch(`/api/admin/batches/${batchId}/partner`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partnerId: v }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Tagged ${j.tagged} card(s).` : j.error || r.statusText);
    router.refresh();
  }
  return (
    <div className={`mt-2 flex flex-wrap items-center gap-2 text-sm ${untagged ? "rounded-lg bg-coral/10 p-2" : ""}`}>
      <span className="font-semibold">Partner</span>
      <PartnerSelect value={v} onChange={setV} className="input py-1 text-sm" />
      <button className="btn-ghost py-1" disabled={!v || (v === value && !untagged)} onClick={save}>
        {untagged ? `Tag ${untagged} untagged card(s)` : "Save"}
      </button>
      {untagged > 0 && !msg && <span className="text-xs text-coral">Untagged cards can't go in a pack.</span>}
      {msg && <span className="text-xs text-navy/60">{msg}</span>}
    </div>
  );
}
