-- Categories
CREATE TABLE "categories" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "parent_id" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "categories_tenant_id_name_key" ON "categories"("tenant_id", "name");
CREATE INDEX "categories_tenant_id_idx" ON "categories"("tenant_id");

-- Add categoryId to products
ALTER TABLE "products" ADD COLUMN "category_id" TEXT;
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "products_tenant_id_category_id_idx" ON "products"("tenant_id", "category_id");

-- Expenses
CREATE TABLE "expenses" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "expenses_tenant_id_paid_at_idx" ON "expenses"("tenant_id", "paid_at");

-- Credit notes
CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT','CONFIRMED','CANCELLED');
CREATE TABLE "credit_notes" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "credit_note_number" TEXT NOT NULL,
  "original_invoice_id" TEXT,
  "customer_id" TEXT,
  "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotal" DECIMAL(10,2) NOT NULL,
  "total_discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total_cgst" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total_sgst" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "grand_total" DECIMAL(10,2) NOT NULL,
  "reason" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credit_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credit_notes_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "credit_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "credit_notes_tenant_id_credit_note_number_key" ON "credit_notes"("tenant_id", "credit_note_number");
CREATE INDEX "credit_notes_tenant_id_idx" ON "credit_notes"("tenant_id");

CREATE TABLE "credit_note_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "credit_note_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "product_name" TEXT NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "selling_price" DECIMAL(10,2) NOT NULL,
  "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "gst_rate" DECIMAL(5,2) NOT NULL,
  "cgst" DECIMAL(10,2) NOT NULL,
  "sgst" DECIMAL(10,2) NOT NULL,
  "total" DECIMAL(10,2) NOT NULL,
  CONSTRAINT "credit_note_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credit_note_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credit_note_items_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "credit_note_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "credit_note_items_tenant_id_credit_note_id_idx" ON "credit_note_items"("tenant_id", "credit_note_id");

-- Quotations
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT','SENT','ACCEPTED','REJECTED','CONVERTED','EXPIRED');
CREATE TABLE "quotations" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "quotation_number" TEXT NOT NULL,
  "customer_id" TEXT,
  "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
  "valid_until" TIMESTAMP(3),
  "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total_discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total_cgst" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total_sgst" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "grand_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "converted_to_invoice_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quotations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quotations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "quotations_tenant_id_quotation_number_key" ON "quotations"("tenant_id", "quotation_number");
CREATE INDEX "quotations_tenant_id_idx" ON "quotations"("tenant_id");

CREATE TABLE "quotation_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "quotation_id" TEXT NOT NULL,
  "product_id" TEXT,
  "product_name" TEXT NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "selling_price" DECIMAL(10,2) NOT NULL,
  "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(10,2) NOT NULL,
  CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quotation_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "quotation_items_tenant_id_quotation_id_idx" ON "quotation_items"("tenant_id", "quotation_id");

-- Loyalty
CREATE TABLE "loyalty_accounts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loyalty_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loyalty_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "loyalty_accounts_tenant_id_customer_id_key" ON "loyalty_accounts"("tenant_id", "customer_id");
CREATE INDEX "loyalty_accounts_tenant_id_idx" ON "loyalty_accounts"("tenant_id");

CREATE TYPE "LoyaltyTxType" AS ENUM ('EARNED','REDEEMED','EXPIRED','ADJUSTED');
CREATE TABLE "loyalty_transactions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "type" "LoyaltyTxType" NOT NULL,
  "reference_id" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loyalty_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loyalty_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "loyalty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "loyalty_transactions_tenant_id_account_id_idx" ON "loyalty_transactions"("tenant_id", "account_id");

-- Coupons
CREATE TYPE "DiscountType" AS ENUM ('FLAT','PERCENTAGE');
CREATE TABLE "coupons" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "discount_type" "DiscountType" NOT NULL DEFAULT 'FLAT',
  "discount_value" DECIMAL(10,2) NOT NULL,
  "min_order_value" DECIMAL(10,2),
  "max_discount" DECIMAL(10,2),
  "usage_limit" INTEGER,
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid_until" TIMESTAMP(3) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coupons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coupons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "coupons_tenant_id_code_key" ON "coupons"("tenant_id", "code");
CREATE INDEX "coupons_tenant_id_is_active_idx" ON "coupons"("tenant_id", "is_active");

-- Audit log
CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entity_id" TEXT,
  "changes" JSONB,
  "ip" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");
CREATE INDEX "audit_logs_tenant_id_entity_idx" ON "audit_logs"("tenant_id", "entity");

-- Supplier payments (accounts payable)
CREATE TABLE "supplier_payments" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "purchase_order_id" TEXT,
  "amount" DECIMAL(10,2) NOT NULL,
  "mode" "PaymentMode" NOT NULL DEFAULT 'CASH',
  "reference_number" TEXT,
  "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_payments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "supplier_payments_tenant_id_supplier_id_idx" ON "supplier_payments"("tenant_id", "supplier_id");

-- Purchase returns (debit notes)
CREATE TYPE "PurchaseReturnStatus" AS ENUM ('DRAFT','CONFIRMED','CANCELLED');
CREATE TABLE "purchase_returns" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "return_number" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "purchase_order_id" TEXT,
  "status" "PurchaseReturnStatus" NOT NULL DEFAULT 'DRAFT',
  "total_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "reason" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "purchase_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "purchase_returns_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "purchase_returns_tenant_id_return_number_key" ON "purchase_returns"("tenant_id", "return_number");
CREATE INDEX "purchase_returns_tenant_id_idx" ON "purchase_returns"("tenant_id");

CREATE TABLE "purchase_return_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "return_id" TEXT NOT NULL,
  "product_id" TEXT,
  "product_name" TEXT NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "purchase_price" DECIMAL(10,2) NOT NULL,
  "total" DECIMAL(10,2) NOT NULL,
  CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_return_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "purchase_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "purchase_return_items_tenant_id_return_id_idx" ON "purchase_return_items"("tenant_id", "return_id");

-- Restaurant tables
CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE','OCCUPIED','RESERVED','CLEANING');
CREATE TABLE "restaurant_tables" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 4,
  "section" TEXT,
  "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "restaurant_tables_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "restaurant_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "restaurant_tables_tenant_id_number_key" ON "restaurant_tables"("tenant_id", "number");
CREATE INDEX "restaurant_tables_tenant_id_status_idx" ON "restaurant_tables"("tenant_id", "status");

-- Menu categories
CREATE TABLE "menu_categories" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "menu_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "menu_categories_tenant_id_name_key" ON "menu_categories"("tenant_id", "name");

-- Add menu_category_id to products
ALTER TABLE "products" ADD COLUMN "menu_category_id" TEXT;
ALTER TABLE "products" ADD CONSTRAINT "products_menu_category_id_fkey" FOREIGN KEY ("menu_category_id") REFERENCES "menu_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Menu modifier groups
CREATE TABLE "menu_modifier_groups" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "multi_select" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "menu_modifier_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "menu_modifier_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "menu_modifier_groups_tenant_id_idx" ON "menu_modifier_groups"("tenant_id");

CREATE TABLE "menu_modifier_options" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "extra_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT "menu_modifier_options_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "menu_modifier_options_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "menu_modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- KOT
CREATE TYPE "KOTStatus" AS ENUM ('PENDING','PREPARING','READY','SERVED','CANCELLED');
CREATE TABLE "kots" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "kot_number" TEXT NOT NULL,
  "table_id" TEXT,
  "customer_id" TEXT,
  "invoice_id" TEXT,
  "status" "KOTStatus" NOT NULL DEFAULT 'PENDING',
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "kots_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "restaurant_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "kots_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "kots_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "kots_tenant_id_kot_number_key" ON "kots"("tenant_id", "kot_number");
CREATE INDEX "kots_tenant_id_status_idx" ON "kots"("tenant_id", "status");

CREATE TABLE "kot_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "kot_id" TEXT NOT NULL,
  "product_id" TEXT,
  "product_name" TEXT NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'piece',
  "notes" TEXT,
  "modifiers" JSONB,
  CONSTRAINT "kot_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kot_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "kot_items_kot_id_fkey" FOREIGN KEY ("kot_id") REFERENCES "kots"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "kot_items_tenant_id_kot_id_idx" ON "kot_items"("tenant_id", "kot_id");

-- Recipes (ingredient mapping for restaurant)
CREATE TABLE "recipes" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "ingredient_product_id" TEXT NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "unit" TEXT NOT NULL,
  CONSTRAINT "recipes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recipes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "recipes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "recipes_ingredient_product_id_fkey" FOREIGN KEY ("ingredient_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "recipes_product_id_ingredient_product_id_key" ON "recipes"("product_id", "ingredient_product_id");
CREATE INDEX "recipes_tenant_id_product_id_idx" ON "recipes"("tenant_id", "product_id");

-- Item variants
CREATE TABLE "product_variants" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "barcode" TEXT,
  "selling_price" DECIMAL(10,2) NOT NULL,
  "purchase_price" DECIMAL(10,2),
  "mrp" DECIMAL(10,2) NOT NULL,
  "current_stock" DECIMAL(10,3) NOT NULL DEFAULT 0,
  "attributes" JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_variants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "product_variants_tenant_id_product_id_idx" ON "product_variants"("tenant_id", "product_id");
CREATE INDEX "product_variants_tenant_id_barcode_idx" ON "product_variants"("tenant_id", "barcode");

-- Loyalty points earned per invoice (column on invoices)
ALTER TABLE "invoices" ADD COLUMN "loyalty_points_earned" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "loyalty_points_redeemed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "coupon_code" TEXT;
