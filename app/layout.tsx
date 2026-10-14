import type { Metadata } from "next";
import "./globals.css";
import { FeelListener } from "@/components/Feel";

export const metadata: Metadata = {
  title: { default: "Pokéroll", template: "%s · Pokéroll" },
  description: "You roll it. Roll a starting lineup or a pack of 12 real Pokémon cards. Daily winner gets a free card.",
  icons: { icon: "/favicon-32.png?v=foil", apple: "/apple-touch-icon.png?v=foil" },
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
