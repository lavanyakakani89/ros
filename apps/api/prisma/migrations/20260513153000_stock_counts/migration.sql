CREATE TABLE "stock_counts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "approved_by" TEXT,
  CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_count_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "stock_count_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "product_name" TEXT NOT NULL,
  "system_qty" DECIMAL(10,3) NOT NULL,
  "counted_qty" DECIMAL(10,3),
  "variance" DECIMAL(10,3) NOT NULL DEFAULT 0,
  CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "stock_counts"
  ADD CONSTRAINT "stock_counts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_count_items"
  ADD CONSTRAINT "stock_count_items_stock_count_id_fkey"
  FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_count_items"
  ADD CONSTRAINT "stock_count_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "stock_counts_tenant_id_status_counted_at_idx"
  ON "stock_counts"("tenant_id", "status", "counted_at");

CREATE UNIQUE INDEX "stock_count_items_stock_count_id_product_id_key"
  ON "stock_count_items"("stock_count_id", "product_id");

CREATE INDEX "stock_count_items_tenant_id_product_id_idx"
  ON "stock_count_items"("tenant_id", "product_id");
