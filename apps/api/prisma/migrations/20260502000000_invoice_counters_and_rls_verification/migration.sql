CREATE TABLE "invoice_counters" (
    "tenant_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "next_seq" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("tenant_id", "date")
);

ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_adjustments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_stock_adjustments" ON "stock_adjustments";
CREATE POLICY "tenant_isolation_stock_adjustments" ON "stock_adjustments"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "invoice_counters" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_invoice_counters" ON "invoice_counters"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
