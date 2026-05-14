CREATE TABLE "stores" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "phone" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_user_assignments" (
  "tenant_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_user_assignments_pkey" PRIMARY KEY ("store_id","user_id")
);

ALTER TABLE "users" ADD COLUMN "primary_store_id" TEXT;
ALTER TABLE "invoices" ADD COLUMN "store_id" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "store_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN "store_id" TEXT;
ALTER TABLE "stock_adjustments" ADD COLUMN "store_id" TEXT;

CREATE UNIQUE INDEX "stores_tenant_id_name_key" ON "stores"("tenant_id", "name");
CREATE UNIQUE INDEX "stores_one_default_per_tenant" ON "stores"("tenant_id") WHERE "is_default" = true AND "is_active" = true;
CREATE INDEX "stores_tenant_id_is_active_idx" ON "stores"("tenant_id", "is_active");
CREATE INDEX "store_user_assignments_tenant_id_user_id_idx" ON "store_user_assignments"("tenant_id", "user_id");
CREATE INDEX "users_tenant_id_primary_store_id_idx" ON "users"("tenant_id", "primary_store_id");
CREATE INDEX "stock_adjustments_tenant_id_store_id_idx" ON "stock_adjustments"("tenant_id", "store_id");
CREATE INDEX "invoices_tenant_id_store_id_invoice_date_idx" ON "invoices"("tenant_id", "store_id", "invoice_date");
CREATE INDEX "purchase_orders_tenant_id_store_id_idx" ON "purchase_orders"("tenant_id", "store_id");
CREATE INDEX "expenses_tenant_id_store_id_paid_at_idx" ON "expenses"("tenant_id", "store_id", "paid_at");

ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_user_assignments" ADD CONSTRAINT "store_user_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_user_assignments" ADD CONSTRAINT "store_user_assignments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_user_assignments" ADD CONSTRAINT "store_user_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_primary_store_id_fkey" FOREIGN KEY ("primary_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_stores" ON "stores"
  USING ("tenant_id" = current_setting('app.tenant_id')::text);

ALTER TABLE "store_user_assignments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_store_user_assignments" ON "store_user_assignments"
  USING ("tenant_id" = current_setting('app.tenant_id')::text);
