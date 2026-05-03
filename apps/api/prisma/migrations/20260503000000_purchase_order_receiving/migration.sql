ALTER TABLE "purchase_order_items"
  ADD COLUMN "product_id" TEXT,
  ADD COLUMN "received_quantity" DECIMAL(10, 3) NOT NULL DEFAULT 0;

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "purchase_order_items_tenant_id_product_id_idx"
  ON "purchase_order_items"("tenant_id", "product_id");
