ALTER TYPE "LoyaltyTxType" ADD VALUE IF NOT EXISTS 'MANUAL_ADJUST';

CREATE TABLE "loyalty_tiers" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "min_points" INTEGER NOT NULL,
  "multiplier" DECIMAL(4,2) NOT NULL DEFAULT 1,
  "color" TEXT NOT NULL DEFAULT '#6b7280',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "loyalty_tiers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loyalty_tiers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "loyalty_tiers_tenant_id_name_key" ON "loyalty_tiers"("tenant_id", "name");
CREATE INDEX "loyalty_tiers_tenant_id_min_points_idx" ON "loyalty_tiers"("tenant_id", "min_points");

ALTER TABLE "customers" ADD COLUMN "tier_id" TEXT;
ALTER TABLE "customers" ADD CONSTRAINT "customers_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "loyalty_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "loyalty_transactions" ADD COLUMN "expires_at" TIMESTAMP(3);
CREATE INDEX "loyalty_transactions_tenant_id_expires_at_idx" ON "loyalty_transactions"("tenant_id", "expires_at");
