CREATE TYPE "WhatsappIntegrationStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR');

CREATE TABLE "whatsapp_integrations" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'whatsapp-cloud',
  "phone_number_id" TEXT,
  "waba_id" TEXT,
  "business_id" TEXT,
  "display_phone_number" TEXT,
  "verified_name" TEXT,
  "access_token_ciphertext" TEXT,
  "token_expires_at" TIMESTAMP(3),
  "status" "WhatsappIntegrationStatus" NOT NULL DEFAULT 'PENDING',
  "last_error" TEXT,
  "connected_at" TIMESTAMP(3),
  "disconnected_at" TIMESTAMP(3),
  "setup_payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "whatsapp_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_integrations_tenant_id_key" ON "whatsapp_integrations"("tenant_id");
CREATE UNIQUE INDEX "whatsapp_integrations_phone_number_id_key" ON "whatsapp_integrations"("phone_number_id");
CREATE INDEX "whatsapp_integrations_tenant_id_status_idx" ON "whatsapp_integrations"("tenant_id", "status");
CREATE INDEX "whatsapp_integrations_phone_number_id_idx" ON "whatsapp_integrations"("phone_number_id");

ALTER TABLE "whatsapp_integrations"
  ADD CONSTRAINT "whatsapp_integrations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "whatsapp_integrations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_whatsapp_integrations" ON "whatsapp_integrations"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::text
    OR current_setting('app.public_whatsapp_webhook', true) = 'true'
  )
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::text);
