-- CreateEnum
CREATE TYPE "DeliveryProofType" AS ENUM ('DELIVERY_PHOTO', 'PAYMENT_SCREENSHOT', 'CUSTOMER_SIGNATURE', 'OTHER');

-- CreateEnum
CREATE TYPE "AppNotificationType" AS ENUM ('DELIVERY_ASSIGNED', 'DELIVERY_STATUS', 'SYSTEM');

-- CreateTable
CREATE TABLE "delivery_proofs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "uploaded_by" TEXT NOT NULL,
  "proof_type" "DeliveryProofType" NOT NULL,
  "object_name" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "notes" TEXT,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "delivery_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_notifications" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" "AppNotificationType" NOT NULL DEFAULT 'SYSTEM',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "is_read" BOOLEAN NOT NULL DEFAULT false,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_proofs_tenant_id_delivery_id_idx" ON "delivery_proofs"("tenant_id", "delivery_id");

-- CreateIndex
CREATE INDEX "delivery_proofs_tenant_id_uploaded_by_created_at_idx" ON "delivery_proofs"("tenant_id", "uploaded_by", "created_at");

-- CreateIndex
CREATE INDEX "app_notifications_tenant_id_user_id_is_read_created_at_idx" ON "app_notifications"("tenant_id", "user_id", "is_read", "created_at");

-- AddForeignKey
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_delivery_id_fkey"
  FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "delivery_proofs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_delivery_proofs" ON "delivery_proofs"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "app_notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_app_notifications" ON "app_notifications"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
