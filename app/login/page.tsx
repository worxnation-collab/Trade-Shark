import { SharkFin } from "@/components/SharkFin";
import { passwordConfigured } from "@/lib/auth";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; e?: string }> }) {
  const { next, e } = await searchParams;
  const configured = passwordConfigured();
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4">
      <form method="post" action="/api/login" className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-2">
          <SharkFin size={36} />
          <div>
            <div className="text-lg font-extrabold">Trade Shark desk</div>
            <div className="text-xs text-navy/60">Scan it. Price it. List it.</div>
          </div>
        </div>
        {!configured && (
          <p className="rounded-md bg-coral/10 p-2 text-sm text-coral">
            TRADE_SHARK_PASSWORD is not set. Add it to .env and restart.
          </p>
        )}
        {e && <p className="text-sm text-coral">Wrong password.</p>}
        <input type="hidden" name="next" value={next ?? "/admin"} />
        <input name="password" type="password" autoFocus placeholder="Password" className="input" disabled={!configured} />
        <button className="btn-primary w-full justify-center" disabled={!configured}>Open the desk</button>
      </form>
    </div>
  );
}
