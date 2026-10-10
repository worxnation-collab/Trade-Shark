-- The winner's link carries a secret code; only its hash is stored. Canonical apply: `npx prisma db push`.
SET search_path TO trade_shark;
ALTER TABLE "RosterRollClaim" ADD COLUMN "codeHash" TEXT;
