import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Trade Shark", template: "%s · Trade Shark" },
  description: "Scan it. Price it. List it. Trading cards from Trade Shark, shipped from Florida.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
