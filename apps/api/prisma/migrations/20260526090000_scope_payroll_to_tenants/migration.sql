-- Scope payroll records to the current RetailOS tenant before exposing payroll APIs.
ALTER TABLE "employees" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "payroll_runs" ADD COLUMN "tenant_id" TEXT;

DO $$
BEGIN
  IF (
    EXISTS (SELECT 1 FROM "employees" WHERE "tenant_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "payroll_runs" WHERE "tenant_id" IS NULL)
  ) AND NOT EXISTS (SELECT 1 FROM "tenants") THEN
    RAISE EXCEPTION 'Cannot scope existing payroll records because no tenants exist';
  END IF;
END $$;

UPDATE "employees"
SET "tenant_id" = (SELECT "id" FROM "tenants" ORDER BY "created_at" ASC LIMIT 1)
WHERE "tenant_id" IS NULL;

UPDATE "payroll_runs"
SET "tenant_id" = (SELECT "id" FROM "tenants" ORDER BY "created_at" ASC LIMIT 1)
WHERE "tenant_id" IS NULL;

ALTER TABLE "employees" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "payroll_runs" ALTER COLUMN "tenant_id" SET NOT NULL;

DROP INDEX IF EXISTS "payroll_runs_period_key";

CREATE INDEX "employees_tenant_id_status_idx" ON "employees"("tenant_id", "status");
CREATE INDEX "employees_tenant_id_department_idx" ON "employees"("tenant_id", "department");
CREATE UNIQUE INDEX "payroll_runs_tenant_id_period_key" ON "payroll_runs"("tenant_id", "period");
CREATE INDEX "payroll_runs_tenant_id_status_idx" ON "payroll_runs"("tenant_id", "status");

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_tenant_id_fkey"
  FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
