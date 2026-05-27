ALTER TABLE "employees"
ADD COLUMN "employee_code" TEXT,
ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now();

WITH numbered AS (
  SELECT id, tenant_id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS seq
  FROM "employees"
)
UPDATE "employees" AS e
SET "employee_code" = 'EMP' || LPAD(numbered.seq::text, 4, '0')
FROM numbered
WHERE numbered.id = e.id;

ALTER TABLE "employees"
ALTER COLUMN "employee_code" SET NOT NULL;

CREATE UNIQUE INDEX "employees_tenant_id_employee_code_key" ON "employees"("tenant_id", "employee_code");

ALTER TABLE "payroll_runs"
ADD COLUMN "generated_at" TIMESTAMPTZ;

UPDATE "payroll_runs" AS pr
SET "generated_at" = pr."run_at"
WHERE EXISTS (
  SELECT 1
  FROM "payslip_lines" pl
  WHERE pl."payroll_run_id" = pr."id"
);

CREATE TABLE "employee_salary_revisions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "previous_salary" NUMERIC(10,2),
  "new_salary" NUMERIC(10,2) NOT NULL,
  "effective_from" DATE NOT NULL,
  "reason" TEXT,
  "changed_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "employee_salary_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_salary_revisions_tenant_id_employee_id_effective_from_idx"
ON "employee_salary_revisions"("tenant_id", "employee_id", "effective_from");

ALTER TABLE "employee_salary_revisions"
ADD CONSTRAINT "employee_salary_revisions_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_salary_revisions"
ADD CONSTRAINT "employee_salary_revisions_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_salary_revisions"
ADD CONSTRAINT "employee_salary_revisions_changed_by_fkey"
FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "employee_salary_revisions" (
  "id",
  "tenant_id",
  "employee_id",
  "previous_salary",
  "new_salary",
  "effective_from",
  "reason",
  "changed_by"
)
SELECT
  gen_random_uuid()::text,
  "tenant_id",
  "id",
  NULL,
  "base_salary",
  "joined_at",
  'Initial salary',
  NULL
FROM "employees";
