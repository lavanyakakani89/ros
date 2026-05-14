ALTER TABLE "tenants" ADD COLUMN "require_po_approval" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "purchase_orders" ADD COLUMN "approval_status" TEXT NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "purchase_orders" ADD COLUMN "approved_by" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "approved_at" TIMESTAMP(3);
ALTER TABLE "purchase_orders" ADD COLUMN "rejected_by" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "rejected_at" TIMESTAMP(3);
ALTER TABLE "purchase_orders" ADD COLUMN "rejection_reason" TEXT;
ALTER TABLE "purchase_orders" ALTER COLUMN "approval_status" SET DEFAULT 'PENDING_APPROVAL';

CREATE INDEX "purchase_orders_tenant_id_approval_status_idx" ON "purchase_orders"("tenant_id", "approval_status");
