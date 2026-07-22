ALTER TABLE "stores"
  ADD COLUMN "depot_name" TEXT,
  ADD COLUMN "depot_address" TEXT,
  ADD COLUMN "depot_latitude" DECIMAL(10,7),
  ADD COLUMN "depot_longitude" DECIMAL(10,7);

UPDATE "stores"
SET
  "depot_name" = COALESCE("depot_name", "name"),
  "depot_address" = COALESCE("depot_address", "address");
