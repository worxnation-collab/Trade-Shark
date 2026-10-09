import { getSettings } from "@/lib/settings";
import { sourceStatus } from "@/lib/sources";
import { SettingsForm } from "./SettingsForm";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const s = await getSettings();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Settings</h1>
      <div className="card p-4 text-sm">
        <h2 className="mb-1 font-bold">API keys (set in .env, not here)</h2>
        <ul className="grid gap-1 md:grid-cols-2">
          {sourceStatus().map((src) => (
            <li key={src.id + src.label} className="flex justify-between gap-2">
              <span>{src.label}</span>
              <span className={src.ok ? "text-teal-2" : "text-navy/50"}>{src.ok ? "on" : src.reason}</span>
            </li>
          ))}
        </ul>
      </div>
      <SettingsForm initial={s} />
    </div>
  );
}
