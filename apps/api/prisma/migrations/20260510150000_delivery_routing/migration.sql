-- Delivery routing, geocoding, and mobile GPS sync foundation.

CREATE TYPE "DeliveryGeocodingStatus" AS ENUM ('PENDING', 'GEOCODED', 'FAILED', 'MANUAL');
CREATE TYPE "DeliveryRouteStatus" AS ENUM ('DRAFT', 'OPTIMIZED', 'DISPATCHED', 'COMPLETED', 'CANCELLED');

ALTER TABLE "deliveries"
  ADD COLUMN "latitude" DECIMAL(10,7),
  ADD COLUMN "longitude" DECIMAL(10,7),
  ADD COLUMN "geocoding_status" "DeliveryGeocodingStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "geocoding_provider" TEXT,
  ADD COLUMN "geocoded_at" TIMESTAMP(3),
  ADD COLUMN "time_window_start" TIMESTAMP(3),
  ADD COLUMN "time_window_end" TIMESTAMP(3),
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "weight_kg" DECIMAL(10,3);

CREATE TABLE "delivery_routes" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "assigned_to" TEXT NOT NULL,
  "route_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "DeliveryRouteStatus" NOT NULL DEFAULT 'OPTIMIZED',
  "depot_latitude" DECIMAL(10,7),
  "depot_longitude" DECIMAL(10,7),
  "total_distance_meters" INTEGER,
  "total_duration_seconds" INTEGER,
  "route_geometry" JSONB,
  "optimization_provider" TEXT,
  "optimized_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "delivery_routes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "delivery_route_stops" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "eta" TIMESTAMP(3),
  "distance_meters" INTEGER,
  "duration_seconds" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "delivery_route_stops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "delivery_location_pings" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "delivery_id" TEXT,
  "latitude" DECIMAL(10,7) NOT NULL,
  "longitude" DECIMAL(10,7) NOT NULL,
  "accuracy_meters" DECIMAL(10,2),
  "battery_pct" INTEGER,
  "captured_at" TIMESTAMP(3) NOT NULL,
  "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "delivery_location_pings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deliveries_tenant_id_assigned_to_status_idx" ON "deliveries"("tenant_id", "assigned_to", "status");
CREATE INDEX "deliveries_tenant_id_latitude_longitude_idx" ON "deliveries"("tenant_id", "latitude", "longitude");
CREATE INDEX "delivery_routes_tenant_id_assigned_to_route_date_idx" ON "delivery_routes"("tenant_id", "assigned_to", "route_date");
CREATE INDEX "delivery_routes_tenant_id_status_idx" ON "delivery_routes"("tenant_id", "status");
CREATE UNIQUE INDEX "delivery_route_stops_delivery_id_key" ON "delivery_route_stops"("delivery_id");
CREATE UNIQUE INDEX "delivery_route_stops_route_id_sequence_key" ON "delivery_route_stops"("route_id", "sequence");
CREATE INDEX "delivery_route_stops_tenant_id_route_id_idx" ON "delivery_route_stops"("tenant_id", "route_id");
CREATE INDEX "delivery_route_stops_tenant_id_delivery_id_idx" ON "delivery_route_stops"("tenant_id", "delivery_id");
CREATE INDEX "delivery_location_pings_tenant_id_user_id_captured_at_idx" ON "delivery_location_pings"("tenant_id", "user_id", "captured_at");
CREATE INDEX "delivery_location_pings_tenant_id_delivery_id_captured_at_idx" ON "delivery_location_pings"("tenant_id", "delivery_id", "captured_at");

ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_route_stops" ADD CONSTRAINT "delivery_route_stops_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_route_stops" ADD CONSTRAINT "delivery_route_stops_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "delivery_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "delivery_route_stops" ADD CONSTRAINT "delivery_route_stops_delivery_id_fkey"
  FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "delivery_location_pings" ADD CONSTRAINT "delivery_location_pings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_location_pings" ADD CONSTRAINT "delivery_location_pings_delivery_id_fkey"
  FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delivery_routes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_delivery_routes" ON "delivery_routes"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "delivery_route_stops" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_delivery_route_stops" ON "delivery_route_stops"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "delivery_location_pings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_delivery_location_pings" ON "delivery_location_pings"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
