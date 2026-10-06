"use client";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button className="btn-primary print:hidden" onClick={() => window.print()}>
      {label}
    </button>
  );
}
