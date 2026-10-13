-- Pack Rip has its own daily winner. Lineup stays kind = 'lineup'.
-- A second row for the same date is allowed only when the kind differs.
-- Canonical apply: `npx prisma db push`. This file is the same change as SQL
-- for the Supabase SQL editor (schema trade_shark).
SET search_path TO trade_shark;

ALTER TABLE "RosterRollClaim" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'lineup';
ALTER TABLE "RosterRollClaim" DROP CONSTRAINT IF EXISTS "RosterRollClaim_pkey";
ALTER TABLE "RosterRollClaim" ADD CONSTRAINT "RosterRollClaim_pkey" PRIMARY KEY ("date", "kind");
