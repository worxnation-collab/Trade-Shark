# Trade Shark

**Scan it. Price it. List it.**

My personal card shop and listing desk. One seller (me). Dump a scanner or phone batch in; Trade Shark pairs fronts and backs, dedupes against inventory, identifies every card with every source it can reach, prices it from every source it can reach, and waits for me to review. Nothing goes live on eBay or TCGplayer by itself.

## Quick start

Data lives in **Supabase**: Postgres (schema `trade_shark`) for inventory and quotes, and a private Storage bucket (`trade-shark-scans`) for scans. The site runs on **Netlify**.

```bash
npm install
cp .env.example .env        # TRADE_SHARK_PASSWORD, DATABASE_URL, DIRECT_URL, SUPABASE_URL, SUPABASE_SECRET_KEY
npx prisma db push          # only needed if the schema changes; tables already exist in Supabase
npm run dev                 # http://localhost:3000/admin
```

Leave `SUPABASE_URL`/`SUPABASE_SECRET_KEY` unset locally and scans go to `DATA_DIR/images` on disk instead (the database is still Postgres).

### Deploy on Netlify

1. Netlify → Add new project → Import from GitHub → this repo, branch `trade-shark-v1` (or `main` once merged). Build settings come from `netlify.toml`.
2. Project configuration → Environment variables: add every key from `.env.example` you use. At minimum `TRADE_SHARK_PASSWORD`, `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SITE_URL` (your Netlify URL).
3. Project configuration → Functions → raise the function timeout to the max your plan allows (26s on Pro). Scryfall/Pokemon lookups fit in 10s; vision calls need the extra room.

How it fits Netlify's limits:
- Scans upload from the browser straight to Supabase Storage through signed upload URLs, so the 6 MB function request limit doesn't apply.
- Images are served as 1-hour signed URLs (admin: password required; shop: only for-sale cards), never as public files.
- Processing runs one card per request with short source timeouts. A source that times out is logged and filled in later by **Reprice batch**.

## Workflow

1. **Upload** (`/admin/upload`): drop a folder or a pile of files, plus an optional CSV manifest and/or pasted lines (one card per line, in order). Files go up in small chunks, so big scanner dumps are fine.
2. **Organize** runs automatically:
   - Pairs fronts and backs by filename (`card001-front`/`card001-back`, `card001_f`/`card001_b`). For files without those tokens, **Auto** checks whether the batch actually contains backs: card backs in a game share one design, so their image fingerprints sit close together (and close to backs already in inventory). It pairs front-then-back only when backs show up in alternating positions, swaps if backs come first, and otherwise treats every file as a front. A file that clearly looks like a back but has no front goes to Unpaired instead of becoming a card. The decision and reason show on the batch page. *Order* forces front-then-back; *Fronts only* never pairs.
   - Dedupes against existing inventory by exact image hash (SHA-256), near-identical image (256-bit dHash, catches rescans), and name + set + number. Fronts only — card backs look the same across a game.
   - Splits **Unreadable** (not an image, HEIC that can't be decoded), **Unpaired**, **Likely bulk** (`bulk`, `common`, `energy` in the name or `bulk` in the manifest) and **Duplicate** files into review piles. Nothing is dropped.
   - Parses year, set, number, name, variant, and grade from the filename, manifest, or pasted line. Detects game: Pokemon, Sports, Magic, Other.
   - Every card keeps original filename(s), hashes, batch id, pair id, winning source, and source confidence.
   - **Flatbed split** (`/admin/flatbed`): scan several raw cards on the copier glass as one JPEG/PNG. OpenCV (in your browser, no vision API) finds every card-shaped rectangle (2.5×3.5 in, any rotation) on a light or dark lid, ignores the lid edge and dust (minimum card area; uses the file's DPI when present), perspective-corrects each card, and crops it with a small margin. You see the sheet with numbered boxes first: click to select, <kbd>Del</kbd> to delete, drag corners to adjust, <kbd>R</kbd> to rotate, <kbd>A</kbd> to add a missed card (drag a box, or click once for a card-size box). Cards that were touching get a dashed coral box to check. Crops are saved in reading order (top to bottom, then left to right) as `batch-001.jpg`, `batch-002.jpg`, … For backs, flip each card in place and scan again: crop N pairs with back crop N, and the page refuses to pair if the two sheets have a different count or row layout. The original sheets are kept for reference. Crops go into the same Inbox; identification and pricing are unchanged. Add more sheets to a batch with **+ Flatbed sheet** on the batch page (numbering continues).
3. **Identify + price** each card (progress bar; re-runnable per card or per batch).
4. **Review** (`/admin/review/:id`): large front, back thumbnail, catalog image, form on the right, price panel. Uncertain fields are outlined in coral.
   - <kbd>J</kbd>/<kbd>K</kbd> next/previous, <kbd>Enter</kbd> save + next, <kbd>F</kbd> flip front/back.
   - Winning source plus alternates; **Use** an alternate to swap identity.
   - Saving confirms the card: priced ≥ minimum → **Ready**, under → **Bulk Hold**, no price → **Identified**.
5. **Pay link (Stripe):** saving a card as Ready first creates a Stripe Payment Link for it: quantity 1, USD at the list price, product name and description from the listing title and description, the front photo when `SITE_URL` is https, US shipping address collection, and a one-sale limit so it can't sell twice. If Stripe fails, the card stays Priced and the error shows on the review screen. The link (with Copy, Open, Regenerate) sits on the review screen, and the public card page gets a **Buy this card** button. Changing the price of a live card regenerates the link (the old one is expired first). After checkout Stripe sends the buyer to `/shop/thank-you?card=<id>` (confetti, nothing else). The card is marked **Sold** only by the signed webhook at `/api/stripe/webhook` (`checkout.session.completed`, matched to the card's current or earlier link) or when you enter a sold price yourself. Stripe Payment Links have no cancel URL; a buyer who backs out returns with the browser's Back button to the card page.
5. **Export** (`/admin/export`): eBay File Exchange **draft** CSV (`Action=Draft`) and a TCGplayer-style CSV. Exported cards become **Listed**. Publish them yourself, then paste the live URL back (export page or review screen).
6. **Shop** (`/`): grid + card page for For Sale cards (Ready or Listed). "Buy on eBay" once a URL is pasted; otherwise a mailto to `SHOP_EMAIL`.

Statuses: `Inbox → Identified → Priced → Ready → Listed → Sold → Archived`, plus `Bulk Hold` and `Lil' Stack`.

## Environment keys

| Key | Required | What it does |
|---|---|---|
| `TRADE_SHARK_PASSWORD` | **yes** | Password for `/admin` and `/api/admin/*`. Unset = nobody can sign in. Changing it logs out every session. |
| `DATABASE_URL` | yes | Supabase **transaction pooler** string (port 6543) with `?pgbouncer=true&connection_limit=1&schema=trade_shark`. |
| `DIRECT_URL` | yes | Supabase **session pooler** string (port 5432) with `?schema=trade_shark`. Used by `prisma db push`. |
| `SUPABASE_URL` | for Netlify | Project URL, e.g. `https://<ref>.supabase.co`. |
| `SUPABASE_SECRET_KEY` | for Netlify | Secret (service role) key. Server-only; lets the app read/write the private scans bucket. Never expose it to the browser. |
| `SUPABASE_BUCKET` | no (default `trade-shark-scans`) | Storage bucket name. |
| `DATA_DIR` | no (default `./data`) | Local-disk scan storage when Supabase Storage isn't configured. |
| `VISION_TIMEOUT_MS` | no (default `22000`) | Per-call vision timeout; keep it under the function timeout. |
| `SITE_URL` | no | Public shop URL. Fills eBay `PicURL` and TCGplayer photo URLs with the public image route. |
| `SHOP_EMAIL` | no | Contact page and "Email to buy" links. |
| `SHOP_OWNER_NAME` | no | Shown on `/about`. |
| `POKEMONTCG_API_KEY` | no | Raises Pokemon TCG API rate limits. The API works without it. |
| `ANTHROPIC_API_KEY` | no | Vision identification with Claude (front + back). Tried first. |
| `ANTHROPIC_MODEL` | no (default `claude-opus-5-5`) | Model for vision calls. |
| `OPENAI_API_KEY` | no | Vision identification with OpenAI, used when Claude isn't configured or fails. |
| `OPENAI_MODEL` | no (default `gpt-4o-mini`) | Model for OpenAI vision calls. |
| `VISION_CONCURRENCY` | no (default `2`) | Max simultaneous vision calls. |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | no | eBay comps (client-credentials app keys). |
| `EBAY_MARKETPLACE` | no (default `EBAY_US`) | Marketplace header for eBay calls. |
| `STRIPE_SECRET_KEY` | to sell direct | Creates Payment Links. Without it, cards can't be marked Ready (the save explains why). Use a restricted key with Payment Links write access if you like. |
| `STRIPE_WEBHOOK_SECRET` | to sell direct | Signing secret for the webhook endpoint `https://<site>/api/stripe/webhook` listening to `checkout.session.completed`. Without it, Stripe sales aren't marked Sold automatically. |
| `GEMINI_API_KEY` | no | Draws the Lil' Stack pack art (closed + torn open) once, server-side, from a text prompt. Without it `/lil-stack` uses the CSS pack. |
| `GEMINI_IMAGE_MODEL` | no (default `gemini-2.5-flash-image`) | Gemini image model for the pack art. |
| `SPORTS_CATALOG_API_KEY` | no | Turns on the `SportsCatalog` adapter. It's a stub until a provider is wired in `lib/sources/sportsCatalog.ts`. |

Missing keys skip that source and record why (`Source log` on each card, `Sources` on the dashboard). They never crash a batch.

### What works with no API keys at all

- Upload, pairing, dedupe, review piles, filename/manifest/pasted-line parsing, game detection.
- **Pokemon TCG API** identification + TCGplayer market/low/mid/high prices (free, no key needed).
- **Scryfall** identification + `usd` / `usd_foil` retail asks for Magic.
- **Pasted sold comps**: paste a block from an eBay sold search (or any "title … $price" list) on the review screen. Junk is filtered out (lots, proxies, graded-vs-raw, wrong number, outliers) and shown struck through with a reason.
- All pricing rules, fee math, Bulk Hold, both CSV exports, dashboard, public shop.

Without vision keys, identification leans on filenames, manifests, and pasted lines, so name your files (`1999_base-set_4-102_charizard_holo-front.jpg`) or bring a manifest when you can.

### eBay: sold comps vs active listings

eBay's Browse API only returns **active** listings. Real sold comps come from the **Marketplace Insights API**, which eBay grants per app. Trade Shark tries Insights first; if your keys don't have it, it falls back to Browse and saves the results as **eBay active asks** (`retail_ask`). Asks are shown for context but never count as sold comps. Pasted comps always work.

## Confidence rule

- Every source returns a confidence from 0 to 1, with per-field confidence where it has one.
- Sources merge into one winner plus alternates. A catalog match (Pokemon TCG API / Scryfall) that agrees with an independent read (vision, manifest, pasted line, filename) gets a boost. Disagreement flags **ID conflict**.
- Vision self-reported confidence is capped at 0.9. Filename parsing caps around 0.55, manifests at 0.85.
- **Threshold: 0.8** (change it in Settings). Under the threshold a card stays in **Inbox**, its shaky fields are highlighted, and it never advances on its own.
- At or over the threshold it may auto-advance to **Identified** and **Priced**. **Ready** only happens when you save the card in review. Listing only happens when you export and publish.

## Pricing rule

The price panel shows every source with its date, kind (sold comp / market / retail ask / Manual), and raw title. Only the latest fetch per source counts; older quotes stay as history.

Suggested list price (editable in Settings):

1. **Median of clean sold comps** (eBay sold + pasted) if there are **3+**.
2. Else **TCGplayer market** (Pokemon, via the Pokemon TCG API).
3. Else blank. Optional extra fallback: Scryfall retail ask (off by default).
4. **Condition multipliers** (NM 1, LP 0.85, MP 0.7, HP 0.5, DMG 0.3) apply only when the source price is NM. TCGplayer market and Scryfall are treated as NM; sold comps count as NM only if every kept title says NM.
5. **Manual override always wins** and is labeled Manual.
6. Under the **minimum list price ($2)** → **Bulk Hold**.
7. Under **$1.00** → **Lil' Stack** (below).

Fees (editable): eBay 13.25% + $0.40, TCGplayer 10.25% + $0.30, Stripe 2.9% + $0.30, Local 0. Shipping profiles: standard $1.00, bubble mailer $4.50, slab $6.00. The panel shows net after fees and shipping for each channel.

**Price conflict** is flagged when source headlines disagree by more than 1.5×.

**Reprice batch** refreshes quotes older than 24 hours (configurable). **Refresh all sources** on a card ignores the window.

## Lil' Stack (free packs)

Cards priced under $1.00 never sell as singles. When a batch finishes identifying and pricing, every card under $1 (Priced or Bulk Hold, with a photo, not a rescan) piles into free packs:

- One batch per pack, up to 12 cards: **Lil' Stack**, **Lil' Stack 2**, 3, … Each pack stores its card ids; a card is in at most one pack and its status is **Lil' Stack**.
- Repricing a card to $1+ (refresh or manual) pulls it out of its pack and back to Bulk Hold / Priced. A card under $1 can't be saved to Ready.
- **Admin → Lil' Stack** shows the pile, the counts, cards waiting to be packed, and **Rebuild packs** (run it after a reprice).
- **`/lil-stack`** (public): "Take a bite." A sealed pack opens only on a full left-to-right swipe (or four right-arrow presses); a short drag snaps back. Opening plays the pop, a small confetti burst and deals the cards out in a fan (front, name, set). **Shuffle** closes it and deals the next pack, or restacks the only pack in a new order. Reduced motion gets a **Tap to open** button and no confetti.
- No price, buy button or checkout anywhere on it, and the page reads only id, name and set (`publicPacks()` in `lib/lilStack.ts`). The public image route serves a packed card's **front only**.
- Pack art: with `GEMINI_API_KEY`, the admin page draws a closed and a torn-open pack once (text prompt only, never card photos) and caches them in `DATA_DIR/brand` (or `brand/` in the bucket). Without it, the CSS pack.

## Exports

- **eBay** (`trade-shark-ebay-*.csv`): Seller Hub Reports / File Exchange format, `Action=Draft`. Upload under Seller Hub → Reports → Uploads; the drafts stay drafts until you publish them. Category ids and business-policy names are in Settings. The ungraded "Card Condition" descriptor codes come from eBay's trading-card condition policy; check them against a fresh Seller Hub template before a large upload.
- **TCGplayer** (`trade-shark-tcgplayer-*.csv`): Pokemon and Magic only. `TCGplayer Id` is filled for Magic (from Scryfall); Pokemon rows match by set/name/number.

## Images and privacy

- Scans live in the private Supabase bucket (or `DATA_DIR/images` locally). `/api/admin/images/*` requires the password.
- The public shop uses `/api/shop/image/:cardId/:side`, which serves a scan **only while its card is Ready or Listed** (or the front of a card in a Lil' Stack). Inbox, Sold, and Archived cards 404.
- The `trade_shark` tables have RLS on and no grants for Supabase's `anon`/`authenticated` roles; only the app's server connection reads them.
- TIFF scans are converted to JPEG on upload so browsers can show them.

## Adding a source

Write an adapter in `lib/sources/` that implements `IdentifyAdapter` or `PriceAdapter` (`lib/sources/types.ts`), returns `{ status, reason, data }`, and never throws. Register it in `lib/sources/index.ts`. The pipeline records a `SourceRun` row for every attempt and persists every quote.

## Development

```bash
npm test          # vitest: parsing, pairing, comps filtering, pricing rule, fees, exports, dHash
npm run lint      # tsc --noEmit
```

Layout: `lib/organize` (pairing, parsing, manifest), `lib/sources` (adapters), `lib/identify` (merge), `lib/pricing` (rule + fees), `lib/listing` (templates + CSV), `lib/pipeline.ts` (ingest → identify → price), `app/(shop)` public site, `app/admin` desk, `app/api` routes.
