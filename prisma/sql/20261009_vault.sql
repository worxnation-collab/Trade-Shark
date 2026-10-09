-- Vault: prize singles held for the player instead of shipping, plus a store-credit ledger.
-- Canonical apply is `npx prisma db push` (this repo has no migrate history); this file is the same change as SQL,
-- for review or for running by hand in the Supabase SQL editor (schema trade_shark). Additive only.
SET search_path TO trade_shark;

-- AlterTable
ALTER TABLE "ShipQuote" ADD COLUMN     "vaultIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "RosterRollClaim" ADD COLUMN     "buyerId" TEXT;

-- CreateTable
CREATE TABLE "VaultItem" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "condition" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_vault',
    "stockStatus" TEXT NOT NULL,
    "orderId" TEXT,
    "wonAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditEntry" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "ref" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VaultItem_buyerId_status_idx" ON "VaultItem"("buyerId", "status");

-- CreateIndex
CREATE INDEX "VaultItem_cardId_idx" ON "VaultItem"("cardId");

-- CreateIndex
CREATE INDEX "VaultItem_orderId_idx" ON "VaultItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultItem_source_sourceRef_key" ON "VaultItem"("source", "sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "CreditEntry_ref_key" ON "CreditEntry"("ref");

-- CreateIndex
CREATE INDEX "CreditEntry_buyerId_idx" ON "CreditEntry"("buyerId");

-- AddForeignKey
ALTER TABLE "VaultItem" ADD CONSTRAINT "VaultItem_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultItem" ADD CONSTRAINT "VaultItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShipOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditEntry" ADD CONSTRAINT "CreditEntry_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Players never reach these tables directly: the app's server routes are the only door, and each one scopes every
-- read and write to the signed-in player's Buyer id. RLS on with no policies shuts out Supabase's public API roles
-- (anon, authenticated); the app's own connection owns the tables and is unaffected.
ALTER TABLE "VaultItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditEntry" ENABLE ROW LEVEL SECURITY;
