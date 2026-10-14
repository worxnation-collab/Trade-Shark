-- One physical-card prize per game per day: lineup, slot, and pack rip.
SET search_path TO trade_shark;

ALTER TABLE "RosterRollClaim" ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'lineup';
ALTER TABLE "RosterRollClaim" DROP CONSTRAINT IF EXISTS "RosterRollClaim_pkey";
ALTER TABLE "RosterRollClaim" ADD PRIMARY KEY (date, kind);
