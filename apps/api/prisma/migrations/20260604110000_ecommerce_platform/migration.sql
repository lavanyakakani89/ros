CREATE TYPE "PlatformModule" AS ENUM (
  'BILLING',
  'INVENTORY',
  'ECOMMERCE',
  'WHATSAPP',
  'DELIVERY',
  'PAYROLL',
  'RESTAURANT'
);

CREATE TYPE "ModuleSubscriptionStatus" AS ENUM (
  'DISABLED',
  'REQUESTED',
  'ACTIVE',
  'SUSPENDED'
);

CREATE TYPE "StorefrontStatus" AS ENUM (
  'DISABLED',
  'REQUESTED',
  'ACTIVE',
  'SUSPENDED'
);

CREATE TYPE "StorefrontTheme" AS ENUM (
  'CLASSIC_RETAIL',
  'PREMIUM_BRAND'
);

CREATE TYPE "StorefrontPaymentProvider" AS ENUM (
  'PLATFORM_RAZORPAY',
  'TENANT_RAZORPAY'
);

CREATE TYPE "StorefrontDomainType" AS ENUM (
  'DEFAULT_SUBDOMAIN',
  'CUSTOM'
);

CREATE TYPE "StorefrontDomainStatus" AS ENUM (
  'REQUESTED',
  'ACTIVE',
  'REJECTED',
  'SUSPENDED'
);

CREATE TYPE "StorefrontApprovalType" AS ENUM (
  'ENABLEMENT',
  'DOMAIN',
  'PAYMENT',
  'THEME',
  'SETTINGS'
);

CREATE TYPE "StorefrontApprovalStatus" AS ENUM (
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

ALTER TABLE "products"
  ADD COLUMN "ecommerce_disabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "customers"
  ADD COLUMN "ecommerce_password_hash" TEXT,
  ADD COLUMN "ecommerce_last_login_at" TIMESTAMP(3);

CREATE TABLE "module_pricing" (
  "id" TEXT NOT NULL,
  "module" "PlatformModule" NOT NULL,
  "display_name" TEXT NOT NULL,
  "description" TEXT,
  "base_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "billing_cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "module_pricing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_module_subscriptions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "module" "PlatformModule" NOT NULL,
  "status" "ModuleSubscriptionStatus" NOT NULL DEFAULT 'DISABLED',
  "price_override" DECIMAL(10,2),
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "billing_cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
  "requested_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "starts_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tenant_module_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "storefront_settings" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "status" "StorefrontStatus" NOT NULL DEFAULT 'DISABLED',
  "theme" "StorefrontTheme" NOT NULL DEFAULT 'CLASSIC_RETAIL',
  "subdomain" TEXT,
  "display_name" TEXT,
  "logo_url" TEXT,
  "hero_title" TEXT,
  "hero_subtitle" TEXT,
  "primary_color" TEXT,
  "accent_color" TEXT,
  "allow_guest_checkout" BOOLEAN NOT NULL DEFAULT true,
  "allow_customer_login" BOOLEAN NOT NULL DEFAULT true,
  "allow_cod" BOOLEAN NOT NULL DEFAULT true,
  "payment_provider" "StorefrontPaymentProvider",
  "tenant_razorpay_key_id" TEXT,
  "tenant_razorpay_key_secret_ciphertext" TEXT,
  "delivery_charge" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "free_delivery_above" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "customizations" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "storefront_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "storefront_domains" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "storefront_id" TEXT,
  "hostname" TEXT NOT NULL,
  "type" "StorefrontDomainType" NOT NULL,
  "status" "StorefrontDomainStatus" NOT NULL DEFAULT 'REQUESTED',
  "requested_by_id" TEXT,
  "approved_by_id" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(3),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "storefront_domains_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "storefront_approval_requests" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "type" "StorefrontApprovalType" NOT NULL,
  "status" "StorefrontApprovalStatus" NOT NULL DEFAULT 'REQUESTED',
  "requested_by_id" TEXT,
  "approved_by_id" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "rejection_reason" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),

  CONSTRAINT "storefront_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "module_pricing_module_key" ON "module_pricing"("module");
CREATE UNIQUE INDEX "tenant_module_subscriptions_tenant_id_module_key" ON "tenant_module_subscriptions"("tenant_id", "module");
CREATE INDEX "tenant_module_subscriptions_module_status_idx" ON "tenant_module_subscriptions"("module", "status");
CREATE UNIQUE INDEX "storefront_settings_tenant_id_key" ON "storefront_settings"("tenant_id");
CREATE UNIQUE INDEX "storefront_settings_subdomain_key" ON "storefront_settings"("subdomain");
CREATE INDEX "storefront_settings_status_idx" ON "storefront_settings"("status");
CREATE UNIQUE INDEX "storefront_domains_hostname_key" ON "storefront_domains"("hostname");
CREATE INDEX "storefront_domains_tenant_id_status_idx" ON "storefront_domains"("tenant_id", "status");
CREATE INDEX "storefront_domains_hostname_status_idx" ON "storefront_domains"("hostname", "status");
CREATE INDEX "storefront_approval_requests_tenant_id_status_idx" ON "storefront_approval_requests"("tenant_id", "status");
CREATE INDEX "storefront_approval_requests_type_status_idx" ON "storefront_approval_requests"("type", "status");
CREATE INDEX "products_tenant_id_ecommerce_disabled_idx" ON "products"("tenant_id", "ecommerce_disabled");

ALTER TABLE "tenant_module_subscriptions"
  ADD CONSTRAINT "tenant_module_subscriptions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "storefront_settings"
  ADD CONSTRAINT "storefront_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "storefront_domains"
  ADD CONSTRAINT "storefront_domains_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "storefront_domains"
  ADD CONSTRAINT "storefront_domains_storefront_id_fkey"
  FOREIGN KEY ("storefront_id") REFERENCES "storefront_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "storefront_approval_requests"
  ADD CONSTRAINT "storefront_approval_requests_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "module_pricing" ("id", "module", "display_name", "description", "base_price", "billing_cycle", "metadata", "updated_at")
VALUES
  ('module_billing', 'BILLING', 'Billing', 'Invoices, POS billing, receipts, payments, and core sales workflows.', 0, 'MONTHLY', '{}', CURRENT_TIMESTAMP),
  ('module_inventory', 'INVENTORY', 'Inventory', 'Products, stock, categories, purchase flow, and stock counts.', 0, 'MONTHLY', '{}', CURRENT_TIMESTAMP),
  ('module_ecommerce', 'ECOMMERCE', 'Ecommerce', 'Tenant storefront, subdomain/custom domain, cart, checkout, customer login, and online payments.', 0, 'MONTHLY', '{}', CURRENT_TIMESTAMP),
  ('module_whatsapp', 'WHATSAPP', 'WhatsApp', 'WhatsApp orders, notifications, campaigns, and embedded signup.', 0, 'MONTHLY', '{}', CURRENT_TIMESTAMP),
  ('module_delivery', 'DELIVERY', 'Delivery', 'Delivery board, route planning, proof capture, and delivery app workflows.', 0, 'MONTHLY', '{}', CURRENT_TIMESTAMP),
  ('module_payroll', 'PAYROLL', 'Payroll', 'Employees, attendance, salary runs, advances, and disbursements.', 0, 'MONTHLY', '{}', CURRENT_TIMESTAMP),
  ('module_restaurant', 'RESTAURANT', 'Restaurant', 'Tables, KOT, kitchen display, modifiers, and restaurant billing.', 0, 'MONTHLY', '{}', CURRENT_TIMESTAMP)
ON CONFLICT ("module") DO NOTHING;
