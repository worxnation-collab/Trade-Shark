-- Optional username + password on a buyer, so a collection can move to another device.
-- Canonical apply is `npx prisma db push`. This file is the same change, for the Supabase SQL editor.
SET search_path TO trade_shark;

ALTER TABLE "Buyer" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "Buyer" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Buyer_username_key" ON "Buyer" ("username");
