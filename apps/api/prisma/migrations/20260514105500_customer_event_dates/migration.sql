ALTER TABLE "customers" ADD COLUMN "birthday" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "anniversary" TIMESTAMP(3);

CREATE INDEX "customers_tenant_id_birthday_idx" ON "customers"("tenant_id", "birthday");
CREATE INDEX "customers_tenant_id_anniversary_idx" ON "customers"("tenant_id", "anniversary");
