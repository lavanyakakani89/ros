CREATE TABLE "whatsapp_campaigns" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "target_type" TEXT NOT NULL DEFAULT 'ALL',
  "target_value" TEXT,
  "sent_count" INTEGER NOT NULL DEFAULT 0,
  "fail_count" INTEGER NOT NULL DEFAULT 0,
  "scheduled_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "whatsapp_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_campaign_recipients" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "phone" TEXT NOT NULL,
  "customer_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "error" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "whatsapp_campaign_recipients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_campaigns_tenant_id_status_created_at_idx" ON "whatsapp_campaigns"("tenant_id", "status", "created_at");
CREATE UNIQUE INDEX "whatsapp_campaign_recipients_campaign_id_phone_key" ON "whatsapp_campaign_recipients"("campaign_id", "phone");
CREATE INDEX "whatsapp_campaign_recipients_tenant_id_campaign_id_status_idx" ON "whatsapp_campaign_recipients"("tenant_id", "campaign_id", "status");

ALTER TABLE "whatsapp_campaigns" ADD CONSTRAINT "whatsapp_campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "whatsapp_campaign_recipients" ADD CONSTRAINT "whatsapp_campaign_recipients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "whatsapp_campaign_recipients" ADD CONSTRAINT "whatsapp_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "whatsapp_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "whatsapp_campaigns" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_whatsapp_campaigns" ON "whatsapp_campaigns"
  USING ("tenant_id" = current_setting('app.tenant_id')::text)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::text);

ALTER TABLE "whatsapp_campaign_recipients" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_whatsapp_campaign_recipients" ON "whatsapp_campaign_recipients"
  USING ("tenant_id" = current_setting('app.tenant_id')::text)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::text);
