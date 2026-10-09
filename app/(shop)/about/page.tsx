import { SharkFin } from "@/components/SharkFin";

export const dynamic = "force-dynamic";
export const metadata = { title: "About" };

export default function About() {
  const owner = process.env.SHOP_OWNER_NAME;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <SharkFin size={48} />
      <h1 className="text-3xl font-extrabold">About Trade Shark</h1>
      <p>
        Trade Shark is my one-person card shop{owner ? `, run by ${owner}` : ""}. I buy, sort, and sell Pokémon, Magic, and sports singles
        out of Florida.
      </p>
      <p>
        Every card is scanned front and back, checked by hand, and priced against recent sales. The photos you see are the exact card you get.
      </p>
      <ul className="list-inside list-disc space-y-1 text-navy/80">
        <li>Ships from Florida with tracking.</li>
        <li>Raw cards ship in a sleeve and top loader; graded cards ship in bubble mailers or boxes.</li>
        <li>Questions about a card? Email me before you buy.</li>
      </ul>
    </div>
  );
}
