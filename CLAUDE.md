# Trade Shark — notes for Claude

- **Single seller.** This is one person's card shop and listing desk. Don't add signups, seller accounts, teams, billing, roles, or "sell on our platform" copy. Public pages speak as one shop ("my shop"), never imply other sellers. A future multi-seller split may change the folder layout; don't build toward it.
- **Never auto-publish listings.** No code path may post, publish, or revise a live listing on eBay, TCGplayer, or anywhere else. Exports produce draft CSVs; the owner publishes manually and pastes the URL back. Status only reaches **Ready** when the owner saves a card in review.
- **Add price/identity sources as adapters** in `lib/sources/` (`IdentifyAdapter` / `PriceAdapter` in `lib/sources/types.ts`), registered in `lib/sources/index.ts`. Adapters fail soft: return `{ status, reason }`, never throw, and skip cleanly when their env key is missing.
- Keep junk out of medians: comps go through `filterComps` (excluded rows are kept and labeled, not deleted). Retail asks (Scryfall, eBay active listings) are never sold comps.
- Every quote is persisted (`PriceQuote`); only the latest fetch per source drives the suggestion. Manual override always wins.
- Confidence threshold (default 0.8) gates auto-advancing. Don't lower it in code.
- Scans are private: serve them only via `/api/admin/images/*` (auth) or `/api/shop/image/*` (for-sale cards only).
- No league, Pokémon, Nintendo, Disney, or other third-party logos in the brand. Colors: navy `#0B1F3A`, teal `#1AA6A6`, sand `#F4EFE6`, coral `#E85D4C`, white.
- Checks: `npm test` and `npm run lint` (tsc). Schema changes: edit `prisma/schema.prisma`, run `npx prisma db push`.
