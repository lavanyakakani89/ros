CREATE TYPE "EcommerceProductFamilySource" AS ENUM (
  'MANUAL',
  'SUGGESTED'
);

CREATE TABLE "ecommerce_product_families" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "attribute_label" TEXT NOT NULL DEFAULT 'Size',
  "source" "EcommerceProductFamilySource" NOT NULL DEFAULT 'MANUAL',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ecommerce_product_families_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ecommerce_product_family_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "variant_label" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ecommerce_product_family_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ecommerce_product_families_tenant_id_slug_key" ON "ecommerce_product_families"("tenant_id", "slug");
CREATE INDEX "ecommerce_product_families_tenant_id_is_active_idx" ON "ecommerce_product_families"("tenant_id", "is_active");
CREATE UNIQUE INDEX "ecommerce_product_family_items_product_id_key" ON "ecommerce_product_family_items"("product_id");
CREATE UNIQUE INDEX "ecommerce_product_family_items_family_id_product_id_key" ON "ecommerce_product_family_items"("family_id", "product_id");
CREATE INDEX "ecommerce_product_family_items_tenant_id_family_id_sort_order_idx" ON "ecommerce_product_family_items"("tenant_id", "family_id", "sort_order");

ALTER TABLE "ecommerce_product_families"
  ADD CONSTRAINT "ecommerce_product_families_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ecommerce_product_family_items"
  ADD CONSTRAINT "ecommerce_product_family_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ecommerce_product_family_items"
  ADD CONSTRAINT "ecommerce_product_family_items_family_id_fkey"
  FOREIGN KEY ("family_id") REFERENCES "ecommerce_product_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ecommerce_product_family_items"
  ADD CONSTRAINT "ecommerce_product_family_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
