import type { Metadata } from "next";
import "./globals.css";
import { FeelListener } from "@/components/Feel";

export const metadata: Metadata = {
  title: { default: "Pokéroll", template: "%s · Pokéroll" },
  description: "You roll it. Roll a starting lineup or a pack of 12 real Pokémon cards. Daily winner gets a free card.",
  icons: { apple: "/apple-touch-icon.png" },
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
