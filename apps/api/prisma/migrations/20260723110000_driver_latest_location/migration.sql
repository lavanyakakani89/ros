ALTER TABLE "users"
  ADD COLUMN "last_latitude" DECIMAL(10,7),
  ADD COLUMN "last_longitude" DECIMAL(10,7),
  ADD COLUMN "last_location_accuracy" DECIMAL(10,2),
  ADD COLUMN "last_location_at" TIMESTAMP(3);

CREATE INDEX "users_tenant_id_role_last_location_at_idx" ON "users"("tenant_id", "role", "last_location_at");
