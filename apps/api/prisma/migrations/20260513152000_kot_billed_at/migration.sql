ALTER TABLE "kots" ADD COLUMN "billed_at" TIMESTAMP(3);

CREATE INDEX "kots_tenant_id_table_id_status_billed_at_idx"
  ON "kots"("tenant_id", "table_id", "status", "billed_at");
