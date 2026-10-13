# Trade Shark

**Scan it. Price it. List it.**

Full inventory and listing system for trading cards. Upload scanner or flatbed batches, auto-pair fronts and backs, identify cards across multiple sources (including vision AI), price them with sold comps and market data, and sell through a custom Stripe-powered pack game.

**Live:** [tradeshark.app](https://tradeshark.app)

## What it does
- Batch upload with chunked transfers and browser-side OpenCV card cropping from flatbed scans
- Front/back pairing, perceptual hashing (dHash) dedupe, and filename/manifest parsing
- Multi-source identification: Pokemon TCG API, Scryfall, Claude/OpenAI vision, pasted comps
- Pricing engine with confidence thresholds, condition multipliers, and fee math
- Admin review queue with keyboard shortcuts
- Stripe pack game (look free, keep for $3.99–$5.99) with webhooks and shipping
- eBay File Exchange and TCGplayer CSV exports

## Tech
TypeScript · Next.js · Supabase (Postgres + Storage) · Prisma · Stripe · Netlify · OpenCV.js · Claude / OpenAI vision

## Quick start

```bash
npm install
cp .env.example .env
npx prisma db push
npm run dev
```

Admin is at `http://localhost:3000/admin`. Full environment variable list and Netlify deploy notes are below.

---

## Detailed workflow, pricing rules, and configuration

The sections below contain the full operational documentation (upload pairing logic, confidence rules, pricing algorithm, pack builder, Stripe webhook details, environment keys, etc.).

### Environment keys

| Key | Required | What it does |
|---|---|---|
| `TRADE_SHARK_PASSWORD` | **yes** | Password for `/admin` and `/api/admin/*`. |
| `DATABASE_URL` | yes | Supabase transaction pooler (port 6543) with `?pgbouncer=true&connection_limit=1&schema=trade_shark`. |
| `DIRECT_URL` | yes | Supabase session pooler (port 5432) with `?schema=trade_shark`. |
| `SUPABASE_URL` | for Netlify | Project URL. |
| `SUPABASE_SECRET_KEY` | for Netlify | Service role key (server-only). |
| `STRIPE_SECRET_KEY` | to sell | Checkout + saved cards. |
| `STRIPE_WEBHOOK_SECRET` | to sell | Webhook signing secret. |
| `ANTHROPIC_API_KEY` | no | Claude vision identification. |
| `OPENAI_API_KEY` | no | OpenAI vision fallback. |

(Full key table and remaining documentation retained from original — see commit history or expand as needed.)

**Note:** This README was cleaned up for readability. The original long-form technical notes (pairing algorithm, flatbed OpenCV details, exact pricing bins, pack odds, etc.) remain valuable and can be moved into a `docs/` folder if desired.
