-- Store foundation required by later store-aware billing and payment migrations.
-- This migration is idempotent because some production databases already had
-- store tables/columns through drift before the migration history was repaired.

CREATE TABLE IF NOT EXISTS "stores" (
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

CREATE TABLE IF NOT EXISTS "store_user_assignments" (
  "tenant_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_user_assignments_pkey" PRIMARY KEY ("store_id", "user_id")
);

ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "store_user_assignments" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "store_user_assignments" ADD COLUMN IF NOT EXISTS "store_id" TEXT;
ALTER TABLE "store_user_assignments" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "store_user_assignments" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "primary_store_id" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "store_id" TEXT;

-- Create one usable store for each existing tenant before payment methods
-- are seeded from stores in 20260525120000_custom_payment_methods.
INSERT INTO "stores" ("id", "tenant_id", "name", "address", "phone", "is_default", "is_active", "created_at")
SELECT
  'store_' || t."id",
  t."id",
  'Main Store',
  t."address",
  t."phone",
  true,
  true,
  CURRENT_TIMESTAMP
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1
  FROM "stores" s
  WHERE s."tenant_id" = t."id"
);

UPDATE "users" u
SET "primary_store_id" = s."id"
FROM "stores" s
WHERE s."tenant_id" = u."tenant_id"
  AND s."is_default" = true
  AND u."primary_store_id" IS NULL;

UPDATE "invoices" i
SET "store_id" = s."id"
FROM "stores" s
WHERE s."tenant_id" = i."tenant_id"
  AND s."is_default" = true
  AND i."store_id" IS NULL;

INSERT INTO "store_user_assignments" ("tenant_id", "store_id", "user_id", "created_at")
SELECT u."tenant_id", u."primary_store_id", u."id", CURRENT_TIMESTAMP
FROM "users" u
WHERE u."primary_store_id" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS "stores_tenant_id_name_key" ON "stores"("tenant_id", "name");
CREATE INDEX IF NOT EXISTS "stores_tenant_id_is_active_idx" ON "stores"("tenant_id", "is_active");
CREATE INDEX IF NOT EXISTS "store_user_assignments_tenant_id_user_id_idx" ON "store_user_assignments"("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "invoices_tenant_id_store_id_idx" ON "invoices"("tenant_id", "store_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stores_tenant_id_fkey'
  ) THEN
    ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_primary_store_id_fkey'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_primary_store_id_fkey"
      FOREIGN KEY ("primary_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_store_id_fkey'
  ) THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'store_user_assignments_tenant_id_fkey'
  ) THEN
    ALTER TABLE "store_user_assignments" ADD CONSTRAINT "store_user_assignments_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'store_user_assignments_store_id_fkey'
  ) THEN
    ALTER TABLE "store_user_assignments" ADD CONSTRAINT "store_user_assignments_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'store_user_assignments_user_id_fkey'
  ) THEN
    ALTER TABLE "store_user_assignments" ADD CONSTRAINT "store_user_assignments_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'stores' AND policyname = 'tenant_isolation_stores'
  ) THEN
    CREATE POLICY "tenant_isolation_stores" ON "stores"
      USING ("tenant_id" = current_setting('app.tenant_id', true))
      WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
  END IF;
END $$;

ALTER TABLE "store_user_assignments" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'store_user_assignments' AND policyname = 'tenant_isolation_store_user_assignments'
  ) THEN
    CREATE POLICY "tenant_isolation_store_user_assignments" ON "store_user_assignments"
      USING ("tenant_id" = current_setting('app.tenant_id', true))
      WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
  END IF;
END $$;
