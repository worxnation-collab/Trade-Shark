import { shopEmail } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contact" };

export default function Contact() {
  const email = shopEmail();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-3xl font-extrabold">Contact</h1>
      <p>Want a card, more photos, or a bundle price? Email me and I'll get back to you.</p>
      {email ? (
        <a className="btn-primary px-5 py-2.5 text-base" href={`mailto:${email}?subject=${encodeURIComponent("Trade Shark question")}`}>
          {email}
        </a>
      ) : (
        <p className="text-sm text-navy/60">Contact email coming soon.</p>
      )}
      <p className="text-sm text-navy/60">Trade Shark ships from Florida with tracking.</p>
    </div>
  );
}
