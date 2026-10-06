import { NextResponse } from "next/server";
import { isCategory } from "@/lib/categories";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/env";
import { currentBuyer, PLAYER_COOKIE, PLAYER_COOKIE_OPTS, playerToken } from "@/lib/game/buyer";
import { isValidZone } from "@/lib/game/rules";
import { easypostReady, verifyAddress } from "@/lib/ship/easypost";
import { stripe, stripeErrorMessage } from "@/lib/stripe";

export const runtime = "nodejs";

const field = (f: FormData, k: string, max = 120) => String(f.get(k) ?? "").trim().slice(0, max);

/**
 * Save a card to play. Name, email and a US shipping address come from my form; the card goes to Stripe
 * Checkout in setup mode (no charge). Returning players can come back here to swap cards.
 */
export async function POST(req: Request) {
  const f = await req.formData();
  const base = siteUrl() || new URL(req.url).origin;
  const back = (msg: string) => NextResponse.redirect(`${base}/play/card?error=${encodeURIComponent(msg)}`, 303);
  const s = stripe();
  if (!s) return back("Payments aren't set up yet.");
  const next = isCategory(field(f, "next")) ? field(f, "next") : "";
  try {
    let buyer = await currentBuyer();
    if (!buyer) {
      const ship = { name: field(f, "name"), line1: field(f, "line1"), line2: field(f, "line2"), city: field(f, "city"), state: field(f, "state", 2).toUpperCase(), postal: field(f, "postal", 10) };
      const email = field(f, "email");
      if (!ship.name || !ship.line1 || !ship.city || !/^[A-Z]{2}$/.test(ship.state) || !/^\d{5}(-\d{4})?$/.test(ship.postal) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        return back("Fill in your name, email and US shipping address.");
      const tz = isValidZone(field(f, "tz", 64)) ? field(f, "tz", 64) : "America/New_York";
      // USPS has to be able to deliver it. If EasyPost is down, it's verified again at checkout.
      const v = easypostReady() ? await verifyAddress({ name: ship.name, street1: ship.line1, street2: ship.line2, city: ship.city, state: ship.state, zip: ship.postal }) : null;
      if (v && !v.ok && !v.timeout) return back(`USPS can't deliver to that address: ${v.error}`);
      const customer = await s.customers.create({
        email,
        name: ship.name,
        shipping: { name: ship.name, address: { line1: ship.line1, line2: ship.line2 || undefined, city: ship.city, state: ship.state, postal_code: ship.postal, country: "US" } },
        metadata: { trade_shark: "player" },
      });
      buyer = await db.buyer.create({
        data: {
          email,
          name: ship.name,
          shipTo: JSON.stringify({ name: ship.name, email, address: { ...ship, country: "US" } }),
          tz,
          stripeCustomerId: customer.id,
          ...(v?.ok ? { easypostAddressId: v.id, addressVerified: true } : {}),
        },
      });
    }
    const session = await s.checkout.sessions.create({
      mode: "setup",
      customer: buyer.stripeCustomerId,
      currency: "usd",
      success_url: `${base}/api/play/card-saved?session_id={CHECKOUT_SESSION_ID}${next ? `&next=${next}` : ""}`,
      cancel_url: `${base}/play/card${next ? `?next=${next}` : ""}`,
      metadata: { buyer_id: buyer.id },
    });
    const res = NextResponse.redirect(session.url!, 303);
    res.cookies.set(PLAYER_COOKIE, playerToken(buyer.id), PLAYER_COOKIE_OPTS);
    return res;
  } catch (e) {
    console.error("signup failed", e);
    return back(stripeErrorMessage(e));
  }
}
