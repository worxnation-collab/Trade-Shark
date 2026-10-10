import { LogoMark } from "@/components/Brand";
import { POKEROLL_URL } from "@/lib/rosterRollLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "About" };

export default function About() {
  const owner = process.env.SHOP_OWNER_NAME;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <LogoMark size={48} />
      <h1 className="font-display text-3xl">About Pokéroll</h1>
      <p>
        Pokéroll is a small Pokémon card game run out of Florida{owner ? ` by ${owner}` : ""}. You roll it two ways:{" "}
        <a href={POKEROLL_URL} className="underline">
          roll a starting lineup
        </a>{" "}
        for the daily free card, or roll a pack of 12 real cards and keep it or put it back.
      </p>
      <p>Every card is a real one from my stock, scanned front and back and checked by hand. The photos you see are the exact card you get.</p>
      <ul className="list-inside list-disc space-y-1 text-navy/80">
        <li>Packs and prizes wait in your Collection until you ship them.</li>
        <li>Ships from Florida with tracking, sleeved and top-loaded.</li>
        <li>Questions? Email me any time.</li>
      </ul>
    </div>
  );
}
