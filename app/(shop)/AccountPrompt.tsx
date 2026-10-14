"use client";

import { useEffect, useState } from "react";

const KEY = "pokeroll.user";

/** Shown after a roll, a pass, or a keep. Skippable. Comes back on the next action until they have an account. */
export function AccountPrompt({ actionKey }: { actionKey: string }) {
  const [username, setUsername] = useState<string | null>(null);
  const [known, setKnown] = useState(false);
  const [hide, setHide] = useState(false);
  const [mode, setMode] = useState<"register" | "login">("register");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHide(false);
    setError("");
  }, [actionKey]);

  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      setUsername(saved);
      setKnown(true);
      return;
    }
    fetch("/api/account", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { username?: string | null }) => {
        if (d.username) {
          localStorage.setItem(KEY, d.username);
          setUsername(d.username);
        }
      })
      .catch(() => undefined)
      .finally(() => setKnown(true));
  }, []);

  if (!known || username || hide) return null;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: mode, username: name, password }),
      });
      const data = (await res.json()) as { ok?: boolean; username?: string; error?: string };
      if (!res.ok || !data.ok || !data.username) {
        setError(data.error ?? "That didn't work.");
        return;
      }
      localStorage.setItem(KEY, data.username);
      setUsername(data.username);
    } catch {
      setError("That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-6 w-full max-w-md rounded-2xl border border-gold/50 bg-[#1a1612] p-4 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="font-display text-xl text-navy">Create an account to store your cards across devices.</p>
      <p className="mt-1 text-sm text-navy/70">A name and a password. Skip it and this device still keeps the cards.</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        maxLength={16}
        placeholder="Username"
        className="mt-3 h-11 w-full rounded-xl border border-gold/30 bg-transparent px-3 text-navy outline-none"
      />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        minLength={8}
        maxLength={72}
        placeholder="Password"
        className="mt-2 h-11 w-full rounded-xl border border-gold/30 bg-transparent px-3 text-navy outline-none"
      />
      {error && <p className="mt-2 text-sm text-gold">{error}</p>}
      <button type="submit" disabled={busy} className="btn-reveal mt-3 h-11 w-full">
        {busy ? "Saving…" : mode === "register" ? "Create account" : "Sign in"}
      </button>
      <button
        type="button"
        className="mt-2 h-10 w-full text-sm font-semibold text-navy/70"
        onClick={() => setMode(mode === "register" ? "login" : "register")}
      >
        {mode === "register" ? "I already have one" : "Create an account instead"}
      </button>
      <button type="button" className="h-10 w-full text-sm text-navy/50" onClick={() => setHide(true)}>
        Not now
      </button>
    </form>
  );
}
