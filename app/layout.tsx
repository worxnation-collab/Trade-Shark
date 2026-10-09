import type { Metadata } from "next";
// Self-hosted type (no Google call at runtime): Archivo for rules and UI, Archivo Black for pack names, titles, the wordmark.
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/archivo/800.css";
import "@fontsource/archivo/900.css";
import "@fontsource/archivo-black/400.css";
import "./globals.css";
import { FeelListener } from "@/components/Feel";

export const metadata: Metadata = {
  title: { default: "Trade Shark", template: "%s · Trade Shark" },
  description: "Scan it. Price it. List it. Trading cards from Trade Shark, shipped from Florida.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <FeelListener />
        {children}
      </body>
    </html>
  );
}
