CREATE TABLE "whatsapp_message_templates" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "template_key" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "whatsapp_message_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_message_templates_tenant_id_template_key_key"
  ON "whatsapp_message_templates"("tenant_id", "template_key");

CREATE INDEX "whatsapp_message_templates_tenant_id_idx"
  ON "whatsapp_message_templates"("tenant_id");

ALTER TABLE "whatsapp_message_templates"
  ADD CONSTRAINT "whatsapp_message_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "whatsapp_message_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_whatsapp_message_templates" ON "whatsapp_message_templates"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::text)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::text);
