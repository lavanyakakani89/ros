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

INSERT INTO "payment_methods"
  ("id", "tenant_id", "store_id", "name", "short_code", "type", "color", "icon", "keyboard_shortcut", "display_order", "is_default", "is_active", "requires_reference", "reference_label")
SELECT 'pm_netbanking_' || "id", "tenant_id", "id", 'Net banking', 'NETBANKING', 'CUSTOM', '#2563eb', 'ti-building-bank', NULL, 5, false, true, true, 'Bank reference'
FROM "stores"
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
FROM "invoices" i, "payment_methods" pm
WHERE ip."invoice_id" = i."id"
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
  AND pm."short_code" = CASE COALESCE(ip."mode"::TEXT, i."payment_mode"::TEXT)
    WHEN 'CREDIT' THEN 'CRED'
    ELSE COALESCE(ip."mode"::TEXT, i."payment_mode"::TEXT)
  END;

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
