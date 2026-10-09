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
5. **Pay link (Stripe):** each 12-card pack gets one Stripe Payment Link when it's built: quantity 1, USD at the sum of its cards, the card names in the description, US shipping address collection, a mailer shipping line, and a one-sale limit. A pack whose cards or price change gets a new link (the old one expired first). After checkout Stripe sends the buyer to `/shop/thank-you?stack=<id>` (a plain thank-you, nothing else). The pack and its cards are marked **Sold** only by the signed webhook at `/api/stripe/webhook` (`checkout.session.completed`, matched to the pack's current or earlier link) or by **Mark sold**. Single-card pay links are retired.
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
| `STRIPE_SECRET_KEY` | to sell | Saves players' cards (Checkout setup mode) and charges them for reveal / keep / blind (PaymentIntents, off-session). A restricted key needs Customers, Checkout Sessions, PaymentIntents, Refunds and Payment Links (to expire old links) write. |
| `SHIPPO_API_KEY` | to ship | USPS Ground Advantage rates, address checks and labels (Shippo). Without it every parcel is the $5.95 fallback and you buy labels by hand. |
| `RESEND_API_KEY`, `MAIL_FROM` | for tracking emails | e.g. `MAIL_FROM="Trade Shark <ship@yourdomain>"` on a domain verified in Resend. Without them labels still work; the order says the email wasn't sent. |
| `PLAYER_SECRET` | recommended | Signs the player cookie. Falls back to `TRADE_SHARK_PASSWORD`, so changing the desk password would sign every player out. |
| `STRIPE_WEBHOOK_SECRET` | to sell direct | Signing secret for the webhook endpoint `https://<site>/api/stripe/webhook` listening to `checkout.session.completed`. Without it, Stripe sales aren't marked Sold automatically. |
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

## The reveal game (the only checkout)

> **$1 to reveal. Keep for $2.99 more. Pass, or let the timer end, and the only option left is a $4.99 pack you see after you pay.**

That sentence and the odds are on screen before the first payment.

1. Pick **Baseball**, **Football** or **Pokemon** (home page). A category with no ready pack says "Restocking".
2. First time: **Save a card** (`/play/card`): name, email, US shipping address, then Stripe Checkout in setup mode. No charge. The browser gets a signed `ts_player` cookie; there's no password.
3. **Reveal for $1**: charged to the saved card first, then a ready pack is reserved for you and all 12 cards show with name, image and engine price. The $1 is spent; it only counts toward the pack just shown.
4. A **30 second** timer runs (server deadline). At 10 s and 20 s the pack graphic nudges and Keep pulses. Nothing is ever charged by the timer.
5. **Keep · $2.99** ($3.99 in all for the pack): the 12 cards go into your Collection, the cycle closes, and you can play again right away.
6. **Pass**, the timer, or leaving the screen: that pack is gone for you (its cards go back to stock and are redrawn). The category is **locked for your account and your card until your local midnight**; the only button left is the **$4.99 blind pack**.
7. **Blind pack**: $4.99 is charged first, then a pack from the same builder is reserved and revealed. No reject. Buying it unlocks a new cycle immediately.

One active cycle per account. Every charge (and any refund, e.g. if the last pack went in the same second) is logged in `GameCharge`. Buying never charges shipping: packs wait in the Collection until the player ships them (see Game shipping).

**Odds (same for peek and blind):** 8 of 12 cards are bulk, usually under $0.25 · 3 are modest, usually $0.25 to $0.75 · 1 is the best card in the pack, usually $0.75 to $2 · Pack value is usually under the keep price · About 18 in 100 packs contain a card priced from $4 to $10 · Chase cards are not in packs until that feature is turned on (with chase on: About 2 in 100 packs contain a card priced at $10 or more).

### Pack builder

Per category, never mixed. Uses the existing engine price on each card; nothing new prices a card.

- **Bins:** bulk < $0.25 · mid $0.25–$0.75 · top $0.75–$2.00 · bump $2.01–$3.99 (member stacks only) · hit $4–$9.99 · chase ≥ $10.
- **Base pack (about 80 in 100):** 7 bulk + 4 mid + 1 top (usually a $1–$2 card), summed **$3.20–$3.80**, close to the $3.99 keep; no card over $3.99.
- **Hit pack (about 18 in 100):** 7 bulk + 4 mid + exactly one $4–$9.99 card, summed **$5–$12**.
- **Chase pack (2 in 100, flag on only):** 7 bulk + 4 mid + one $10+ card, marked CHASE on the pull sheet.
- The mix is counted over the last 100 packs built in that category. Every built pack counts, so a kept hit counts as a sold hit. No new hits while hits are over 20% of the last 100 or over a fifth of the ready queue. A draw outside its band is thrown out and drawn again; if a bin can't fill a slot the category stays closed (never padded).
- Packs are drawn ahead, up to 50 ready per category, numbered for good ("Pokemon Pack 12"), after every batch, reprice, card save and pass, and with **Draw packs**. A purchase only reserves a pack that already exists, at random from the one queue peeks and blind buys share.
- Each pack has a printable **pull sheet** (Admin → Packs → the pack number): 12 cards with prices, HIT / CHASE marked, a location note.

### Chase cards (off by default)

Any scanned card with an engine price of **$10 or more** is on that category's chase list (Admin → Packs). The flag can only be turned on once the category has one. While it's off, no $10+ card is ever in a pack and the odds say *Chase cards are not in packs until that feature is turned on*. When it's on, about 2 in 100 built packs are chase packs (one reserved per category at a time) and the odds say *About 2 in 100 packs contain a card priced at $10 or more.* Turning it off takes ready chase packs apart.

### Game shipping (hands-off)

A bought pack (keep or blind) is stored on the account, never auto-shipped. **Collection** (`/collection`) lists bought packs by category, date and pack number; tap one to see its 12 framed cards with tilt, **Exit** to go back. **Ship** at the bottom: pick one or more stored packs, confirm the address (Shippo-verified), see one **USPS Ground Advantage** rate for one combined parcel (6 × 4 in; 4 oz plus 1.5 oz per extra pack, an inch taller per 4 packs), and pay shipping only. One label for the whole selection: the PDF is stored, tracking emailed (`RESEND_API_KEY` + `MAIL_FROM`), and **Admin → Orders** shows **Print Pack 12, Pack 14** and **Dropped off**. Shippo (`SHIPPO_API_KEY`) ships from 1424 Orchid Lane, Kissimmee, FL 34744. If the rate call fails, $5.95 is charged and the order gets a **Buy label** button. The member mailer credit zeros one parcel per billing period.

### Membership ($7.99/month, optional)

No midnight lockout · one mailer credit a month (zeros one label) · one member stack a month (the top slot bumped to a $2–$4 card) · the first hour of every new drop. It does not add reveals, make everyday packs cheaper, or ship every pack free. Join and cancel at `/play/member` (Stripe subscription; perks last to the end of the paid month).

### Brand

The pack is drawn from the fin (`components/Pack.tsx`: flat navy body, one gold edge, the fin, the category name in Archivo Black), the same drawing for every category and the only object with a shadow. Stages are flat color (`components/Stage.tsx`): Pokémon near-black with one soft light behind the pack, Baseball and Football two flat daylight felts. Type is Archivo, with Archivo Black for pack names, page titles and the wordmark, self-hosted from `@fontsource`. The shop is sand with a gold edge; shop actions are the navy button with a gold edge. The desk is a dark bench (`.desk` on the admin shell). Text never sits on the art. No image files, no image APIs, no confetti in the shop.

### Card presentation

Players see the real scan, framed: on upload it's straightened, the scanner background trimmed, and laid on a white rounded border with a thin inner edge and a soft shadow, kept sharp (scaled down only). An opened pack shows the best card first and large (name, set, number and variant under it, never on the scan), the other eleven in one sideways strip. Drag to tilt: thumbs about 8°, the big card about 18°, snapping back; holo, reverse, foil, refractor and parallel cards get a small highlight that follows your finger, commons stay matte. Tap a thumb to open it larger. No flips, no card backs, no gyroscope.

### Category

From what identification already read (no new source): game Pokemon → Pokemon; sports by league words ("Football", "NFL", "Bowman"…), full team names, then unique nicknames. Basketball, Magic and anything ambiguous stay **unsorted**, in inventory. Pick a category by hand (Packs page or review screen) and it sticks.

**Admin → Packs** shows each category's bins and what's short, built packs by status, live odds, the chase list with its toggle, recent packs with their cards and values, and unsorted cards. **Admin → Orders** lists kept and blind packs with the player's address for **Mark shipped**.

## Shipping (before the game)

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
- The public shop uses `/api/shop/image/:cardId/front`, which is retired; game cards are served by `/api/play/image/:id` **only to the player holding or owning that pack**. Inbox, Sold, and Archived cards 404.
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
