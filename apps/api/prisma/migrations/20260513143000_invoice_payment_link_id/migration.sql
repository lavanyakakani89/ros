ALTER TABLE "invoices"
ADD COLUMN "payment_link_id" TEXT;

CREATE INDEX "invoices_tenant_id_payment_link_id_idx"
ON "invoices"("tenant_id", "payment_link_id");
