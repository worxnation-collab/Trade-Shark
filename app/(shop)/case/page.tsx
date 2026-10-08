import Link from "next/link";
import { caseCards } from "@/lib/caseStock";
import { CaseReel } from "./CaseReel";

export const dynamic = "force-dynamic";
export const metadata = { title: "The case · Trade Shark" };

/** The case: real cards from my stock drifting by. Look only; packs are the only thing for sale. */
export default async function CasePage() {
  const cards = await caseCards().catch(() => []);
  return (
    <section className="-mx-4 -my-8 sm:-my-10">
      <div className="px-4 pb-3 pt-6 text-center">
        <h1 className="text-3xl font-black tracking-tight text-navy sm:text-4xl">The case</h1>
        <div className="gold-rule mx-auto mt-2" aria-hidden />
        <p className="mx-auto mt-3 max-w-md text-sm text-navy/70">
          Real cards from my stock, drifting by. Tap one for a closer look. Cards aren&apos;t sold one by one: they turn up in{" "}
          <Link href="/" className="underline">
            packs
          </Link>
          .
        </p>
      </div>
      {cards.length ? <CaseReel cards={cards} /> : <p className="px-4 py-16 text-center text-navy/60">The case is being restocked.</p>}
    </section>
  );
}
