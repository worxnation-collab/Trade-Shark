# Trade Shark — notes for Claude

- **Single seller.** This is one person's card shop and listing desk. Don't add signups, seller accounts, teams, billing, roles, or "sell on our platform" copy. Public pages speak as one shop ("my shop"), never imply other sellers. A future multi-seller split may change the folder layout; don't build toward it.
- **Never auto-publish listings.** No code path may post, publish, or revise a live listing on eBay, TCGplayer, or anywhere else. Exports produce draft CSVs; the owner publishes manually and pastes the URL back. Status only reaches **Ready** when the owner saves a card in review.
- **Stripe is the direct-buy path.** Saving a card into Ready/Listed creates its Payment Link first (`lib/payLink.ts`); if Stripe fails the card stays Priced. One link per card, quantity 1, single completed checkout. Regenerating expires the old link first. A card becomes Sold only from the signed webhook (`/api/stripe/webhook`, matched by current or previous link id) or by hand, never from the thank-you redirect. No carts, buyer accounts, or subscriptions.
- Public pages read cards only through `PUBLIC_CARD_SELECT` (no cost, margin, comps, notes, or Stripe ids).
- Delight (`lib/client/feel.ts`): one short pop on primary buttons, confetti only when a card goes live or sells. Respect the Mute toggle and prefers-reduced-motion; never block a save on it.
- **Add price/identity sources as adapters** in `lib/sources/` (`IdentifyAdapter` / `PriceAdapter` in `lib/sources/types.ts`), registered in `lib/sources/index.ts`. Adapters fail soft: return `{ status, reason }`, never throw, and skip cleanly when their env key is missing.
- Keep junk out of medians: comps go through `filterComps` (excluded rows are kept and labeled, not deleted). Retail asks (Scryfall, eBay active listings) are never sold comps.
- Every quote is persisted (`PriceQuote`); only the latest fetch per source drives the suggestion. Manual override always wins.
- Confidence threshold (default 0.8) gates auto-advancing. Don't lower it in code.
- Scans are private: serve them only via `/api/admin/images/*` (auth) or `/api/shop/image/*` (for-sale cards only).
- No league, Pokémon, Nintendo, Disney, or other third-party logos in the brand. Colors: navy `#0B1F3A`, teal `#1AA6A6`, sand `#F4EFE6`, coral `#E85D4C`, white.
- Data: Supabase Postgres, schema `trade_shark` (Prisma), and the private `trade-shark-scans` bucket via `lib/storage.ts`. Hosting: Netlify — keep each request short (one card per process call) and send large uploads straight to Storage.
- Flatbed split runs client-side with opencv.js (`lib/flatbed/*`, served from `public/vendor` by `scripts/copy-opencv.mjs`). Never send a whole flatbed sheet to a vision API to split it. Front/back crops pair only by sheet position with identical layouts (`checkSheetPairing`); never guess pairs.
- Checks: `npm test` and `npm run lint` (tsc). Schema changes: edit `prisma/schema.prisma`, run `npx prisma db push` (uses `DIRECT_URL`).
