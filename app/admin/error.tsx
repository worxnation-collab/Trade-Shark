"use client";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto max-w-xl space-y-3 p-6">
      <h1 className="text-xl font-extrabold">Something went wrong on the desk</h1>
      <p className="text-sm text-navy/70">
        Usually the database or storage is unreachable. Check the Netlify function logs{error.digest ? ` for digest ${error.digest}` : ""}.
      </p>
      <button className="btn-primary" onClick={reset}>Try again</button>
    </div>
  );
}
