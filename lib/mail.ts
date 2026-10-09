/**
 * Transactional email (tracking links) through Resend's HTTP API. Optional: without RESEND_API_KEY and MAIL_FROM
 * nothing is sent and the order says so. Never throws.
 */
export async function sendMail(m: { to: string; subject: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return { ok: false, error: "Email isn't set up (RESEND_API_KEY / MAIL_FROM)." };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { ok: false, error: `Email failed (${r.status}): ${(await r.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
