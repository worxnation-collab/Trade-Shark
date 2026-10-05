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
   - Saving confirms the card: priced → stock (**Priced**), and it joins its category's next pack. No price → **Identified**.
5. **Pay link (Stripe):** each 12-card pack gets one Stripe Payment Link when it's built: quantity 1, USD at the sum of its cards, the card names in the description, US shipping address collection, a mailer shipping line, and a one-sale limit. A pack whose cards or price change gets a new link (the old one expired first). After checkout Stripe sends the buyer to `/shop/thank-you?stack=<id>` (confetti, nothing else). The pack and its cards are marked **Sold** only by the signed webhook at `/api/stripe/webhook` (`checkout.session.completed`, matched to the pack's current or earlier link) or by **Mark sold**. Single-card pay links are retired.
5. **Export** (`/admin/export`): eBay File Exchange **draft** CSV (`Action=Draft`) and a TCGplayer-style CSV. Exported cards become **Listed**. Publish them yourself, then paste the live URL back (export page or review screen).
6. **Shop** (`/`): the catalog of three packs; each opens at `/packs/<category>`.

Statuses: `Inbox` (held) → stock (`Priced` / `Bulk Hold`) or `Needs a look` → `In a pack` (internally `LilStack`) → `Sold`, plus `Pulled`, `Listed` (exported to a marketplace by hand) and `Archived`.

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
| `STRIPE_SECRET_KEY` | to sell direct | Creates Payment Links. Without it, packs open but have no Buy button. Use a restricted key with Payment Links write access if you like. |
| `STRIPE_WEBHOOK_SECRET` | to sell direct | Signing secret for the webhook endpoint `https://<site>/api/stripe/webhook` listening to `checkout.session.completed`. Without it, Stripe sales aren't marked Sold automatically. |
| `GEMINI_API_KEY` | no | Server-only. Draws the pack art (closed + torn open) once, server-side, from a text prompt. Without it the shop uses the CSS pack. |
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
7. Any priced card can go in a pack; under $1 the price just stays exact.

Fees (editable): eBay 13.25% + $0.40, TCGplayer 10.25% + $0.30, Stripe 2.9% + $0.30, Local 0. Shipping profiles: standard $1.00, bubble mailer $4.50, slab $6.00. The panel shows net after fees and shipping for each channel.

**Price conflict** is flagged when source headlines disagree by more than 1.5×.

**Reprice batch** refreshes quotes older than 24 hours (configurable). **Refresh all sources** on a card ignores the window.

## Upload → packs, no review step

A fresh batch runs straight through on its batch page (it starts by itself): **stand upright**, identify, price, sort into a category, pack.

**Upright first.** Every crop is turned upright on its own before anything else: the vision model names the edge where the card's title sits, the card is turned, and the turned image is checked again. The front and its back get the same turn, saved over the crop. On real flatbed crops turned every which way this got 32/32. Without `ANTHROPIC_API_KEY`, sideways crops get a layout guess (original kept) and wait in Needs a look; portrait crops are left as scanned. A card that's still sideways is never published: it waits in **Needs a look** marked "rotation", with ↻ buttons. Flatbed's hand-rotate controls now live in a collapsed "Fallback" panel.

| Result | What happens |
|---|---|
| No name (identification failed) or no usable photo | **Held** in Inbox for me. Names are never invented; a filename guess doesn't count. |
| $5 and under | **Stock** right away; it joins its category's next pack. |
| Over $5, still sideways, or the same scan twice | **Needs a look** (admin only) with the suggested price and source. |

**Price rule:** one number per source (sold-comp median, TCGplayer market, Scryfall, eBay active median), then the median of those. One source = that number. No source = **$1**. Rounded to the nearest dollar, minimum $1 (under $1 stays exact). Uncertain or disagreeing prices still go to stock; the sources are stored on the card, and the shop shows the small-print disclaimers instead of warnings.

**Admin → Needs a look** (`/admin/queue`): sorted by suggested price. **Approve** puts a card in stock for its category's next pack. **Correct** changes the name or price first.

Every card and pack page carries the small print: *For fun, not a grade. Photos are of the cards in the pack. / Prices are a cute-shop estimate, not a market quote. / Every pack shows all 12 cards before you pay. / Shipping is calculated at checkout.*

## Packs: the only thing the shop sells

Three products: **Baseball Pack**, **Football Pack**, **Pokemon Pack**. One tier each. No basketball, no Magic. Cards never sell one at a time; identified, priced cards stay in inventory and go into packs.

- **Category** comes from what identification already read (no new source): game Pokemon → Pokemon; sports by league words ("Football", "NFL", "Bowman"…), full team names (San Francisco Giants vs New York Giants), then unique nicknames (Yankees, Chiefs). Basketball, Magic, and anything ambiguous stay **unsorted**: in inventory, never packed. Pick a category by hand (Packs page or review screen) and it sticks through repricing.
- **A pack is exactly 12 cards of one category**, built across batches, oldest cards first, a card in one pack only (status **In a pack**, internally `LilStack`). Fewer than 12 left over → they wait in stock (the Packs page says how many more fill the next one).
- **Price = the exact sum of the 12 cards' existing prices.** No other pricing source, no rounding. Shipping is its own line: a tracked bubble mailer, never free.
- Packs rebuild after every batch, reprice and card save, and with **Rebuild packs** (Admin → Packs). Stable: unchanged packs keep their pay link; a pack that lost a card refills from stock (new link) or dissolves back to stock if it can't reach 12.
- **Buying:** one Stripe Payment Link per pack (`Pokemon Pack, Trade Shark`, the card names in the description, quantity 1, one checkout).
- **`/packs/<category>`**: a sealed pack opens only on a full left-to-right swipe (or four right-arrow presses). Opening is free and shows all 12 cards (front, name, set; never a card's own price). Only then does **Buy this pack** appear, with cards + shipping = total. **Shuffle** deals the next unsold pack. Reduced motion: **Tap to open**.
- **Sold:** only the signed webhook (`checkout.session.completed` on the pack's link) or **Mark sold** on the admin page. The pack and its 12 cards become Sold (the sale is split across the cards by list price).
- **Admin → Packs** shows each category's packs with every card, its value and the pay link, stock counts, unsorted cards with a category picker, sold packs and pack art. The review screen shows which pack a card is in.
- Pack art: with `GEMINI_API_KEY`, the admin page draws a closed and a torn-open pack once (text prompt only, never card photos). Without it, the CSS pack.

## Home: the catalog

The home page is the three products, each with how many packs are up and their price range ("Restocking" when none). `/shop` and `/lil-stack` redirect there; single-card pages are gone. The wow score is still computed as an admin tag, but nothing public ranks by it any more.

## Shipping

The buyer pays shipping on top of the price. It's its own line on the Stripe checkout, never baked into a card or pack price. Rates live in **Settings → Shipping the buyer pays**:

| Method | Default | When |
|---|---|---|
| Stamped envelope | $1.50 | Old single-card sales only (singles aren't sold now). |
| Tracked bubble mailer | $6.00 | Every pack. Ships from Florida with tracking. |
| Free | $0 | Never on a pack. |

- Every buy button has the math above it: "Cards $4 · Shipping $6 · Total $10".
- Changing a rate in Settings replaces the live pay links (chunked, a few per request).
- The webhook splits the checkout into merchandise (`soldPrice`) and shipping (`shippingCharged`), and keeps the method and the ship-to address Stripe collected.
- **Admin → Orders** lists sold packs, unshipped first, with the method and address. Mailers take a tracking number before **Mark shipped**; envelopes say "no tracking".

## Exports

- **eBay** (`trade-shark-ebay-*.csv`): Seller Hub Reports / File Exchange format, `Action=Draft`. Upload under Seller Hub → Reports → Uploads; the drafts stay drafts until you publish them. Category ids and business-policy names are in Settings. The ungraded "Card Condition" descriptor codes come from eBay's trading-card condition policy; check them against a fresh Seller Hub template before a large upload.
- **TCGplayer** (`trade-shark-tcgplayer-*.csv`): Pokemon and Magic only. `TCGplayer Id` is filled for Magic (from Scryfall); Pokemon rows match by set/name/number.

## Images and privacy

- Scans live in the private Supabase bucket (or `DATA_DIR/images` locally). `/api/admin/images/*` requires the password.
- The public shop uses `/api/shop/image/:cardId/front`, which serves a card's front **only while it sits in an open pack**. Inbox, Sold, and Archived cards 404.
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
