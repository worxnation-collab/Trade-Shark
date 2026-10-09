import { notFound } from "next/navigation";
import { doorSlug, isDoor, passwordConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trade Shark", robots: { index: false, follow: false } };

/** The founder door (FOUNDER_DOOR). Any other top-level path is a plain 404. Always the password screen, never the desk. */
export default async function Door({ params }: { params: Promise<{ door: string }> }) {
  const { door } = await params;
  if (!isDoor(door) || !passwordConfigured()) notFound();
  return (
    <div className="flex min-h-screen items-center justify-center bg-sand px-4">
      <form method="post" action="/api/login" className="w-full max-w-xs space-y-3">
        <input type="hidden" name="door" value={doorSlug()!} />
        <input name="password" type="password" autoFocus autoComplete="current-password" aria-label="Password" className="input w-full" />
        <button className="btn-dark w-full justify-center">Enter</button>
      </form>
    </div>
  );
}
