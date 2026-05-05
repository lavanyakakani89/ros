ALTER TABLE "products"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "part_group" TEXT,
  ADD COLUMN "legacy_sub_category_id" TEXT,
  ADD COLUMN "wholesale_price" DECIMAL(10,2),
  ADD COLUMN "default_discount_percent" DECIMAL(5,2),
  ADD COLUMN "cess_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "purchase_unit" TEXT,
  ADD COLUMN "sales_unit" TEXT,
  ADD COLUMN "alternate_unit" TEXT,
  ADD COLUMN "conversion_value" DECIMAL(10,3),
  ADD COLUMN "godown" TEXT,
  ADD COLUMN "rack" TEXT,
  ADD COLUMN "default_sale_qty" DECIMAL(10,3);

ALTER TABLE "product_batches"
  ADD COLUMN "mfg_date" TIMESTAMP(3);

ALTER TABLE "customers"
  ADD COLUMN "customer_code" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "postal_code" TEXT,
  ADD COLUMN "remarks" TEXT,
  ADD COLUMN "account_no" TEXT,
  ADD COLUMN "account_name" TEXT,
  ADD COLUMN "bank" TEXT,
  ADD COLUMN "branch" TEXT,
  ADD COLUMN "ifsc_code" TEXT,
  ADD COLUMN "gstin" TEXT,
  ADD COLUMN "pan" TEXT,
  ADD COLUMN "cin" TEXT,
  ADD COLUMN "opening_balance_type" TEXT,
  ADD COLUMN "opening_balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "tcs_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "credit_limit_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "credit_days" INTEGER,
  ADD COLUMN "item_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "item_discount_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "customers_tenant_id_customer_code_key" ON "customers"("tenant_id", "customer_code");
