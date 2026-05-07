-- CreateEnum
CREATE TYPE "WhatsappDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "WhatsappMessageStatus" AS ENUM ('RECEIVED', 'PARSED', 'QUEUED', 'SENT', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "WhatsappOrderStatus" AS ENUM ('DRAFT_CREATED', 'NEEDS_REVIEW', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "whatsapp_messages" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "direction" "WhatsappDirection" NOT NULL,
  "phone" TEXT NOT NULL,
  "customer_name" TEXT,
  "customer_id" TEXT,
  "invoice_id" TEXT,
  "delivery_id" TEXT,
  "external_message_id" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'baileys',
  "message_type" TEXT NOT NULL DEFAULT 'text',
  "body" TEXT,
  "payload" JSONB,
  "status" "WhatsappMessageStatus" NOT NULL DEFAULT 'RECEIVED',
  "error" TEXT,
  "received_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_orders" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "message_id" TEXT,
  "customer_id" TEXT,
  "invoice_id" TEXT,
  "phone" TEXT NOT NULL,
  "customer_name" TEXT,
  "raw_text" TEXT NOT NULL,
  "parsed_items" JSONB,
  "unmatched_lines" JSONB,
  "status" "WhatsappOrderStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "whatsapp_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_tenant_id_external_message_id_key" ON "whatsapp_messages"("tenant_id", "external_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_messages_tenant_id_phone_created_at_idx" ON "whatsapp_messages"("tenant_id", "phone", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_tenant_id_invoice_id_idx" ON "whatsapp_messages"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_orders_invoice_id_key" ON "whatsapp_orders"("invoice_id");

-- CreateIndex
CREATE INDEX "whatsapp_orders_tenant_id_status_created_at_idx" ON "whatsapp_orders"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_orders_tenant_id_phone_idx" ON "whatsapp_orders"("tenant_id", "phone");

-- Enable RLS
ALTER TABLE "whatsapp_messages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_whatsapp_messages" ON "whatsapp_messages"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "whatsapp_orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_whatsapp_orders" ON "whatsapp_orders"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
