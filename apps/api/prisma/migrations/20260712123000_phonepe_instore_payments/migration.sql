ALTER TABLE "payment_methods"
  ADD COLUMN "integration_provider" VARCHAR(32),
  ADD COLUMN "integration_config" JSONB,
  ADD COLUMN "manual_override_allowed" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "payment_integration_attempts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "payment_method_id" TEXT NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "channel" VARCHAR(16) NOT NULL,
  "external_order_id" VARCHAR(64) NOT NULL,
  "external_transaction_id" VARCHAR(64) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "provider_state" VARCHAR(32),
  "reference_number" VARCHAR(128),
  "provider_reference_id" VARCHAR(128),
  "response_code" VARCHAR(64),
  "qr_string" TEXT,
  "qr_data_url" TEXT,
  "expires_at" TIMESTAMP(3),
  "raw_init_response" JSONB,
  "raw_status_response" JSONB,
  "raw_callback_payload" JSONB,
  "manual_override_by" TEXT,
  "manual_override_reason" VARCHAR(256),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_integration_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_integration_attempts_external_transaction_id_key"
  ON "payment_integration_attempts"("external_transaction_id");

CREATE INDEX "payment_integration_attempts_tenant_id_payment_method_id_created_at_idx"
  ON "payment_integration_attempts"("tenant_id", "payment_method_id", "created_at");

CREATE INDEX "payment_integration_attempts_tenant_id_status_created_at_idx"
  ON "payment_integration_attempts"("tenant_id", "status", "created_at");

CREATE INDEX "payment_integration_attempts_store_id_created_at_idx"
  ON "payment_integration_attempts"("store_id", "created_at");

ALTER TABLE "payment_integration_attempts"
  ADD CONSTRAINT "payment_integration_attempts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_integration_attempts"
  ADD CONSTRAINT "payment_integration_attempts_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_integration_attempts"
  ADD CONSTRAINT "payment_integration_attempts_payment_method_id_fkey"
  FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_integration_attempts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_payment_integration_attempts" ON "payment_integration_attempts"
  USING ("tenant_id" = current_setting('app.tenant_id', true));
