CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'WARNING', 'SUSPENDED');

ALTER TABLE "tenants"
  ADD COLUMN "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE TYPE "SuperAdminRole" AS ENUM ('OWNER', 'MANAGER', 'SUPPORT');

CREATE TABLE "super_admins" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "SuperAdminRole" NOT NULL DEFAULT 'SUPPORT',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "super_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_admins_email_key" ON "super_admins"("email");

ALTER TABLE "super_admins"
  ADD CONSTRAINT "super_admins_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "super_admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "super_admin_sessions" (
  "id" TEXT NOT NULL,
  "super_admin_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "super_admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "super_admin_sessions_super_admin_id_idx" ON "super_admin_sessions"("super_admin_id");
CREATE INDEX "super_admin_sessions_expires_at_idx" ON "super_admin_sessions"("expires_at");

ALTER TABLE "super_admin_sessions"
  ADD CONSTRAINT "super_admin_sessions_super_admin_id_fkey"
  FOREIGN KEY ("super_admin_id") REFERENCES "super_admins"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "super_admin_logs" (
  "id" TEXT NOT NULL,
  "super_admin_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_type" TEXT,
  "target_id" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "super_admin_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "super_admin_logs_super_admin_id_idx" ON "super_admin_logs"("super_admin_id");
CREATE INDEX "super_admin_logs_target_type_target_id_idx" ON "super_admin_logs"("target_type", "target_id");

ALTER TABLE "super_admin_logs"
  ADD CONSTRAINT "super_admin_logs_super_admin_id_fkey"
  FOREIGN KEY ("super_admin_id") REFERENCES "super_admins"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "LicensePlan" AS ENUM ('STARTER', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE');

CREATE TYPE "BillingCycle" AS ENUM (
  'ONE_TIME',
  'MONTHLY',
  'QUARTERLY',
  'HALF_YEARLY',
  'YEARLY',
  'TWO_YEARLY',
  'THREE_YEARLY'
);

CREATE TABLE "tenant_licenses" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "plan" "LicensePlan" NOT NULL,
  "billing_cycle" "BillingCycle" NOT NULL,
  "start_date" TIMESTAMP(3) NOT NULL,
  "expiry_date" TIMESTAMP(3) NOT NULL,
  "amount_paid" DECIMAL(10,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "payment_ref" TEXT,
  "payment_mode" TEXT,
  "notes" TEXT,
  "created_by_id" TEXT,
  "last_modified_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tenant_licenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_licenses_tenant_id_key" ON "tenant_licenses"("tenant_id");
CREATE INDEX "tenant_licenses_expiry_date_idx" ON "tenant_licenses"("expiry_date");

ALTER TABLE "tenant_licenses"
  ADD CONSTRAINT "tenant_licenses_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
