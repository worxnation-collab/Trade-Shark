"use client";

import { useState } from "react";

/** Only rendered while consignment is open. The server refuses it while locked anyway. */
export function ConsignForm() {
  const [f, setF] = useState({ name: "", email: "", about: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    const r = await fetch("/api/consign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? "Got it! I'll email you before you mail anything." : j.error || "That didn't send.");
  }
  return (
    <div className="space-y-2 rounded-xl border-2 border-navy bg-white p-4">
      <p className="font-black">Ask to send a box</p>
      <input className="input" placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="input" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <textarea className="input" rows={3} placeholder="What's in the box? (sport or game, about how many cards)" value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} />
      <button className="btn-reveal" disabled={busy} onClick={send}>
        {busy ? "Sending…" : "Send request"}
      </button>
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
