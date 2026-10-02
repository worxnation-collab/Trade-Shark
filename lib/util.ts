/** Simple concurrency limiter (no deps). */
export function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    queue.shift()!();
  };
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
  };
}

export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {},
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: string }> {
  const { timeoutMs = 15000, retries = 1, ...rest } = init;
  let last = "";
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
      lastStatus = res.status;
      if (res.ok) return { ok: true, status: res.status, data: (await res.json()) as T };
      const body = await res.text().catch(() => "");
      const html = /^\s*</.test(body);
      last = `HTTP ${res.status}${body && !html ? `: ${body.slice(0, 200)}` : ""}`;
      // Only retry server-side trouble and rate limits.
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      last = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  return { ok: false, status: lastStatus, error: last };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return `$${n.toFixed(2)}`;
}

export function norm(s: string | null | undefined) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "004" -> "4", "4/102" -> "4", "SWSH050" stays. */
export function normNumber(s: string | null | undefined) {
  const n = (s ?? "").trim().split(/[/\s]/)[0].replace(/^#/, "");
  return /^\d+$/.test(n) ? String(parseInt(n, 10)) : n.toLowerCase();
}

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function titleCase(s: string) {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
