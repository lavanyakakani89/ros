-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CASH', 'UPI', 'CARD', 'CREDIT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SettlementFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'REVIEWED', 'SETTLED');

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "settlement_terms" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "short_code" VARCHAR(12) NOT NULL,
    "type" "PaymentMethodType" NOT NULL DEFAULT 'CUSTOM',
    "color" VARCHAR(16) NOT NULL DEFAULT '#1a6e4a',
    "icon" VARCHAR(64) NOT NULL DEFAULT 'ti-cash',
    "keyboard_shortcut" VARCHAR(8),
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "requires_reference" BOOLEAN NOT NULL DEFAULT false,
    "reference_label" VARCHAR(64),
    "allows_split" BOOLEAN NOT NULL DEFAULT true,
    "upi_id" VARCHAR(128),
    "upi_qr_data" TEXT,
    "partner_id" TEXT,
    "opening_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "settlement_frequency" "SettlementFrequency",
    "allowed_roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- Older tenants can predate the multi-store setup and therefore have no store rows.
-- Seed a default store before creating payment methods, otherwise legacy invoices
-- and payments cannot be mapped to Cash/UPI/Card methods.
INSERT INTO "stores"
  ("id", "tenant_id", "name", "address", "phone", "is_default", "is_active", "created_at")
SELECT 'store_' || t."id", t."id", COALESCE(NULLIF(t."name", ''), 'Main Store'), t."address", t."phone", true, true, CURRENT_TIMESTAMP
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1
  FROM "stores" s
  WHERE s."tenant_id" = t."id"
);

WITH first_stores AS (
  SELECT DISTINCT ON ("tenant_id") "id", "tenant_id"
  FROM "stores"
  WHERE "is_active" = true
  ORDER BY "tenant_id", "is_default" DESC, "created_at" ASC
)
UPDATE "stores" s
SET "is_default" = true
FROM first_stores fs
WHERE s."id" = fs."id"
  AND NOT EXISTS (
    SELECT 1
    FROM "stores" existing
    WHERE existing."tenant_id" = fs."tenant_id"
      AND existing."is_default" = true
      AND existing."is_active" = true
  );

WITH default_stores AS (
  SELECT DISTINCT ON ("tenant_id") "tenant_id", "id"
  FROM "stores"
  WHERE "is_active" = true
  ORDER BY "tenant_id", "is_default" DESC, "created_at" ASC
)
UPDATE "users" u
SET "primary_store_id" = ds."id"
FROM default_stores ds
WHERE u."tenant_id" = ds."tenant_id"
  AND u."primary_store_id" IS NULL;

INSERT INTO "store_user_assignments" ("tenant_id", "store_id", "user_id", "created_at")
SELECT u."tenant_id", u."primary_store_id", u."id", CURRENT_TIMESTAMP
FROM "users" u
WHERE u."primary_store_id" IS NOT NULL
ON CONFLICT DO NOTHING;

WITH default_stores AS (
  SELECT DISTINCT ON ("tenant_id") "tenant_id", "id"
  FROM "stores"
  WHERE "is_active" = true
  ORDER BY "tenant_id", "is_default" DESC, "created_at" ASC
)
UPDATE "invoices" i
SET "store_id" = ds."id"
FROM default_stores ds
WHERE i."tenant_id" = ds."tenant_id"
  AND i."store_id" IS NULL;

WITH default_stores AS (
  SELECT DISTINCT ON ("tenant_id") "tenant_id", "id"
  FROM "stores"
  WHERE "is_active" = true
  ORDER BY "tenant_id", "is_default" DESC, "created_at" ASC
)
UPDATE "purchase_orders" po
SET "store_id" = ds."id"
FROM default_stores ds
WHERE po."tenant_id" = ds."tenant_id"
  AND po."store_id" IS NULL;

WITH default_stores AS (
  SELECT DISTINCT ON ("tenant_id") "tenant_id", "id"
  FROM "stores"
  WHERE "is_active" = true
  ORDER BY "tenant_id", "is_default" DESC, "created_at" ASC
)
UPDATE "expenses" e
SET "store_id" = ds."id"
FROM default_stores ds
WHERE e."tenant_id" = ds."tenant_id"
  AND e."store_id" IS NULL;

WITH default_stores AS (
  SELECT DISTINCT ON ("tenant_id") "tenant_id", "id"
  FROM "stores"
  WHERE "is_active" = true
  ORDER BY "tenant_id", "is_default" DESC, "created_at" ASC
)
UPDATE "stock_adjustments" sa
SET "store_id" = ds."id"
FROM default_stores ds
WHERE sa."tenant_id" = ds."tenant_id"
  AND sa."store_id" IS NULL;

-- Seed default methods for every existing store.
INSERT INTO "payment_methods"
  ("id", "tenant_id", "store_id", "name", "short_code", "type", "color", "icon", "keyboard_shortcut", "display_order", "is_default", "is_active")
SELECT 'pm_cash_' || "id", "tenant_id", "id", 'Cash', 'CASH', 'CASH', '#1a6e4a', 'ti-cash', 'Ctrl+1', 1, true, true
FROM "stores"
ON CONFLICT DO NOTHING;

INSERT INTO "payment_methods"
  ("id", "tenant_id", "store_id", "name", "short_code", "type", "color", "icon", "keyboard_shortcut", "display_order", "is_default", "is_active")
SELECT 'pm_upi_' || "id", "tenant_id", "id", 'UPI', 'UPI', 'UPI', '#7f77dd', 'ti-qrcode', 'Ctrl+2', 2, true, true
FROM "stores"
ON CONFLICT DO NOTHING;

INSERT INTO "payment_methods"
  ("id", "tenant_id", "store_id", "name", "short_code", "type", "color", "icon", "keyboard_shortcut", "display_order", "is_default", "is_active")
SELECT 'pm_card_' || "id", "tenant_id", "id", 'Card', 'CARD', 'CARD', '#378add', 'ti-credit-card', 'Ctrl+3', 3, true, true
FROM "stores"
ON CONFLICT DO NOTHING;

INSERT INTO "payment_methods"
  ("id", "tenant_id", "store_id", "name", "short_code", "type", "color", "icon", "keyboard_shortcut", "display_order", "is_default", "is_active")
SELECT 'pm_credit_' || "id", "tenant_id", "id", 'Credit', 'CRED', 'CREDIT', '#854f0b', 'ti-user-dollar', 'Ctrl+4', 4, true, true
FROM "stores"
ON CONFLICT DO NOTHING;

-- Preserve any legacy netbanking history as a regular custom method.
INSERT INTO "payment_methods"
  ("id", "tenant_id", "store_id", "name", "short_code", "type", "color", "icon", "display_order", "is_default", "is_active")
SELECT 'pm_netbanking_' || s."id", s."tenant_id", s."id", 'Net Banking', 'NETBANKING', 'CUSTOM', '#334155', 'ti-building-bank', 5, false, true
FROM "stores" s
WHERE EXISTS (
    SELECT 1
    FROM "invoices" i
    WHERE i."tenant_id" = s."tenant_id"
      AND COALESCE(i."store_id", s."id") = s."id"
      AND i."payment_mode"::TEXT = 'NETBANKING'
  )
  OR EXISTS (
    SELECT 1
    FROM "payments" p
    JOIN "invoices" i ON i."id" = p."invoice_id"
    WHERE i."tenant_id" = s."tenant_id"
      AND COALESCE(i."store_id", s."id") = s."id"
      AND p."mode"::TEXT = 'NETBANKING'
  )
ON CONFLICT DO NOTHING;

-- Migrate invoice display method to a payment method reference.
ALTER TABLE "invoices" ADD COLUMN "payment_method_id" TEXT;

UPDATE "invoices" i
SET "payment_method_id" = pm."id"
FROM "payment_methods" pm
WHERE pm."store_id" = COALESCE(
    i."store_id",
    (
      SELECT s."id"
      FROM "stores" s
      WHERE s."tenant_id" = i."tenant_id"
      ORDER BY s."is_default" DESC, s."created_at" ASC
      LIMIT 1
    )
  )
  AND pm."short_code" = CASE i."payment_mode"::TEXT
    WHEN 'CREDIT' THEN 'CRED'
    ELSE i."payment_mode"::TEXT
  END;

UPDATE "invoices" i
SET "payment_method_id" = pm."id"
FROM "payment_methods" pm
WHERE i."payment_method_id" IS NULL
  AND pm."store_id" = COALESCE(
    i."store_id",
    (
      SELECT s."id"
      FROM "stores" s
      WHERE s."tenant_id" = i."tenant_id"
      ORDER BY s."is_default" DESC, s."created_at" ASC
      LIMIT 1
    )
  )
  AND pm."short_code" = 'CASH';

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_payment_method_id_fkey"
  FOREIGN KEY ("payment_method_id")
  REFERENCES "payment_methods"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing Payment model becomes invoice payment legs.
ALTER TABLE "payments" RENAME TO "invoice_payments";
ALTER TABLE "invoice_payments" RENAME COLUMN "paid_at" TO "recorded_at";
ALTER TABLE "invoice_payments" ALTER COLUMN "amount" TYPE DECIMAL(12,2);
ALTER TABLE "invoice_payments" ALTER COLUMN "mode" DROP NOT NULL;
ALTER TABLE "invoice_payments" ADD COLUMN "payment_method_id" TEXT;
ALTER TABLE "invoice_payments" ADD COLUMN "cashier_id" TEXT;
ALTER TABLE "invoice_payments" ADD COLUMN "voided_at" TIMESTAMP(3);
ALTER TABLE "invoice_payments" ADD COLUMN "void_reason" TEXT;
ALTER TABLE "invoice_payments" ADD COLUMN "void_authorised_by" TEXT;

UPDATE "invoice_payments" ip
SET "payment_method_id" = pm."id"
FROM "invoices" i
JOIN "payment_methods" pm ON pm."store_id" = COALESCE(
    i."store_id",
    (
      SELECT s."id"
      FROM "stores" s
      WHERE s."tenant_id" = i."tenant_id"
      ORDER BY s."is_default" DESC, s."created_at" ASC
      LIMIT 1
    )
  )
WHERE ip."invoice_id" = i."id"
  AND pm."short_code" = CASE COALESCE(ip."mode"::TEXT, i."payment_mode"::TEXT)
    WHEN 'CREDIT' THEN 'CRED'
    ELSE COALESCE(ip."mode"::TEXT, i."payment_mode"::TEXT)
  END;

UPDATE "invoice_payments" ip
SET "payment_method_id" = pm."id"
FROM "invoices" i
JOIN "payment_methods" pm ON pm."store_id" = COALESCE(
    i."store_id",
    (
      SELECT s."id"
      FROM "stores" s
      WHERE s."tenant_id" = i."tenant_id"
      ORDER BY s."is_default" DESC, s."created_at" ASC
      LIMIT 1
    )
  )
WHERE ip."invoice_id" = i."id"
  AND ip."payment_method_id" IS NULL
  AND pm."short_code" = 'CASH';

UPDATE "invoice_payments" ip
SET "cashier_id" = ip."created_by"
WHERE EXISTS (
  SELECT 1 FROM "users" u WHERE u."id" = ip."created_by"
);

ALTER TABLE "invoice_payments" ALTER COLUMN "payment_method_id" SET NOT NULL;

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_method_id" TEXT NOT NULL,
    "partner_id" TEXT,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "opening_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_sales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_refunds" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "settled_at" TIMESTAMP(3),
    "settled_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partners_tenant_id_store_id_idx" ON "partners"("tenant_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_store_id_short_code_key" ON "payment_methods"("store_id", "short_code");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_store_id_keyboard_shortcut_key" ON "payment_methods"("store_id", "keyboard_shortcut");

-- CreateIndex
CREATE INDEX "payment_methods_tenant_id_store_id_is_active_display_order_idx" ON "payment_methods"("tenant_id", "store_id", "is_active", "display_order");

-- CreateIndex
CREATE INDEX "payment_methods_partner_id_idx" ON "payment_methods"("partner_id");

-- CreateIndex
CREATE INDEX "invoice_payments_tenant_id_recorded_at_idx" ON "invoice_payments"("tenant_id", "recorded_at");

-- CreateIndex
CREATE INDEX "invoice_payments_payment_method_id_recorded_at_idx" ON "invoice_payments"("payment_method_id", "recorded_at");

-- CreateIndex
CREATE INDEX "invoice_payments_invoice_id_idx" ON "invoice_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "settlements_tenant_id_payment_method_id_period_start_period_end_idx" ON "settlements"("tenant_id", "payment_method_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "settlements_partner_id_idx" ON "settlements"("partner_id");

-- AddForeignKey
ALTER TABLE "partners"
  ADD CONSTRAINT "partners_tenant_id_fkey"
  FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners"
  ADD CONSTRAINT "partners_store_id_fkey"
  FOREIGN KEY ("store_id")
  REFERENCES "stores"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods"
  ADD CONSTRAINT "payment_methods_tenant_id_fkey"
  FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods"
  ADD CONSTRAINT "payment_methods_store_id_fkey"
  FOREIGN KEY ("store_id")
  REFERENCES "stores"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods"
  ADD CONSTRAINT "payment_methods_partner_id_fkey"
  FOREIGN KEY ("partner_id")
  REFERENCES "partners"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments"
  ADD CONSTRAINT "invoice_payments_payment_method_id_fkey"
  FOREIGN KEY ("payment_method_id")
  REFERENCES "payment_methods"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments"
  ADD CONSTRAINT "invoice_payments_cashier_id_fkey"
  FOREIGN KEY ("cashier_id")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments"
  ADD CONSTRAINT "invoice_payments_void_authorised_by_fkey"
  FOREIGN KEY ("void_authorised_by")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_tenant_id_fkey"
  FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_payment_method_id_fkey"
  FOREIGN KEY ("payment_method_id")
  REFERENCES "payment_methods"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_partner_id_fkey"
  FOREIGN KEY ("partner_id")
  REFERENCES "partners"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_settled_by_fkey"
  FOREIGN KEY ("settled_by")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_partners" ON "partners"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_payment_methods" ON "payment_methods"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "settlements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_settlements" ON "settlements"
  USING ("tenant_id" = current_setting('app.tenant_id', true));
