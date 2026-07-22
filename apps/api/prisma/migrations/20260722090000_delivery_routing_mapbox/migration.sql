-- CreateEnum
CREATE TYPE "DeliveryRoutePlanStatus" AS ENUM (
  'DRAFT',
  'GEOCODING',
  'LOCATION_REVIEW_REQUIRED',
  'QUEUED',
  'OPTIMIZING',
  'OPTIMIZATION_FAILED',
  'READY_FOR_REVIEW',
  'APPLIED',
  'PUBLISHED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

-- CreateEnum
CREATE TYPE "DeliveryRouteStopStatus" AS ENUM (
  'PLANNED',
  'LOCKED',
  'EN_ROUTE',
  'ARRIVED',
  'DELIVERED',
  'FAILED',
  'RESCHEDULED',
  'SKIPPED',
  'CANCELLED'
);

-- CreateEnum
CREATE TYPE "DeliveryRouteStatus" AS ENUM (
  'PLANNED',
  'PUBLISHED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "expo_push_tokens" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "platform" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "expo_push_tokens_pkey" PRIMARY KEY ("id")
);

-- Align existing store-aware schema drift.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "primary_store_id" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "store_id" TEXT;

-- CreateTable
CREATE TABLE "customer_locations" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "label" TEXT,
  "address_line_1" TEXT NOT NULL,
  "address_line_2" TEXT,
  "landmark" TEXT,
  "locality" TEXT,
  "city" TEXT,
  "state" TEXT,
  "postal_code" TEXT,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "geocoded_address" TEXT,
  "geocoding_provider" TEXT,
  "geocoding_query" TEXT,
  "geocoding_result_id" TEXT,
  "geocoding_accuracy" TEXT,
  "geocoding_confidence" DECIMAL(5,4),
  "geocoding_raw_response" JSONB,
  "geocoded_at" TIMESTAMP(3),
  "manually_verified_at" TIMESTAMP(3),
  "manually_verified_by_id" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "customer_locations_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "deliveries"
  ADD COLUMN "customer_location_id" TEXT,
  ADD COLUMN "delivery_address_snapshot" JSONB,
  ADD COLUMN "delivery_latitude" DECIMAL(10,7),
  ADD COLUMN "delivery_longitude" DECIMAL(10,7);

-- CreateTable
CREATE TABLE "delivery_route_plans" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "DeliveryRoutePlanStatus" NOT NULL DEFAULT 'DRAFT',
  "provider" TEXT,
  "provider_job_id" TEXT,
  "routing_profile" TEXT NOT NULL DEFAULT 'mapbox/driving',
  "optimization_objective" TEXT,
  "depot_name" TEXT,
  "depot_address" TEXT,
  "depot_latitude" DECIMAL(10,7),
  "depot_longitude" DECIMAL(10,7),
  "total_distance_meters" INTEGER,
  "total_duration_seconds" INTEGER,
  "raw_request" JSONB,
  "raw_result" JSONB,
  "provider_error" TEXT,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "delivery_route_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_routes" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "route_plan_id" TEXT NOT NULL,
  "route_index" INTEGER NOT NULL DEFAULT 0,
  "assigned_to" TEXT,
  "status" "DeliveryRouteStatus" NOT NULL DEFAULT 'PLANNED',
  "geometry" JSONB,
  "distance_meters" INTEGER,
  "duration_seconds" INTEGER,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "delivery_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_route_stops" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "delivery_id" TEXT,
  "sequence" INTEGER NOT NULL,
  "status" "DeliveryRouteStopStatus" NOT NULL DEFAULT 'PLANNED',
  "stop_type" TEXT NOT NULL DEFAULT 'DELIVERY',
  "address_snapshot" JSONB NOT NULL,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "eta" TIMESTAMP(3),
  "distance_from_previous_meters" INTEGER,
  "duration_from_previous_seconds" INTEGER,
  "service_seconds" INTEGER,
  "is_locked" BOOLEAN NOT NULL DEFAULT false,
  "locked_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "delivery_route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "expo_push_tokens_token_key" ON "expo_push_tokens"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "expo_push_tokens_tenant_id_user_id_idx" ON "expo_push_tokens"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "customer_locations_tenant_id_customer_id_idx" ON "customer_locations"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_locations_tenant_id_latitude_longitude_idx" ON "customer_locations"("tenant_id", "latitude", "longitude");

-- CreateIndex
CREATE INDEX "deliveries_tenant_id_customer_location_id_idx" ON "deliveries"("tenant_id", "customer_location_id");

-- CreateIndex
CREATE INDEX "delivery_route_plans_tenant_id_status_idx" ON "delivery_route_plans"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "delivery_route_plans_tenant_id_created_at_idx" ON "delivery_route_plans"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "delivery_routes_tenant_id_route_plan_id_idx" ON "delivery_routes"("tenant_id", "route_plan_id");

-- CreateIndex
CREATE INDEX "delivery_routes_tenant_id_assigned_to_idx" ON "delivery_routes"("tenant_id", "assigned_to");

-- CreateIndex
CREATE INDEX "delivery_route_stops_tenant_id_route_id_sequence_idx" ON "delivery_route_stops"("tenant_id", "route_id", "sequence");

-- CreateIndex
CREATE INDEX "delivery_route_stops_tenant_id_delivery_id_idx" ON "delivery_route_stops"("tenant_id", "delivery_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_primary_store_id_fkey'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_primary_store_id_fkey"
      FOREIGN KEY ("primary_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_store_id_fkey'
  ) THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expo_push_tokens_tenant_id_fkey'
  ) THEN
    ALTER TABLE "expo_push_tokens" ADD CONSTRAINT "expo_push_tokens_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expo_push_tokens_user_id_fkey'
  ) THEN
    ALTER TABLE "expo_push_tokens" ADD CONSTRAINT "expo_push_tokens_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_manually_verified_by_id_fkey"
  FOREIGN KEY ("manually_verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_customer_location_id_fkey"
  FOREIGN KEY ("customer_location_id") REFERENCES "customer_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route_plans" ADD CONSTRAINT "delivery_route_plans_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route_plans" ADD CONSTRAINT "delivery_route_plans_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_route_plan_id_fkey"
  FOREIGN KEY ("route_plan_id") REFERENCES "delivery_route_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_assigned_to_fkey"
  FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route_stops" ADD CONSTRAINT "delivery_route_stops_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route_stops" ADD CONSTRAINT "delivery_route_stops_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "delivery_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route_stops" ADD CONSTRAINT "delivery_route_stops_delivery_id_fkey"
  FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "expo_push_tokens" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'expo_push_tokens' AND policyname = 'tenant_isolation_expo_push_tokens'
  ) THEN
    CREATE POLICY "tenant_isolation_expo_push_tokens" ON "expo_push_tokens"
      USING ("tenant_id" = current_setting('app.tenant_id', true))
      WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
  END IF;
END $$;

ALTER TABLE "customer_locations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_customer_locations" ON "customer_locations"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "delivery_route_plans" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_delivery_route_plans" ON "delivery_route_plans"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "delivery_routes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_delivery_routes" ON "delivery_routes"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "delivery_route_stops" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_delivery_route_stops" ON "delivery_route_stops"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
