-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'ON_DUTY');

-- CreateEnum
CREATE TYPE "PayAdvanceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RECOVERED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "base_salary" DECIMAL(10,2) NOT NULL,
    "salary_type" "SalaryType" NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "shift_start" TIME(3),
    "shift_end" TIME(3),
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_advances" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "status" "PayAdvanceStatus" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "recovered_in" TEXT,

    CONSTRAINT "pay_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "run_by" TEXT,
    "notes" TEXT,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip_lines" (
    "id" TEXT NOT NULL,
    "payroll_run_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "days_worked" DECIMAL(6,2) NOT NULL,
    "overtime_hours" DECIMAL(8,2) NOT NULL,
    "gross_pay" DECIMAL(10,2) NOT NULL,
    "overtime_pay" DECIMAL(10,2) NOT NULL,
    "advances_deducted" DECIMAL(10,2) NOT NULL,
    "other_deductions" DECIMAL(10,2) NOT NULL,
    "net_pay" DECIMAL(10,2) NOT NULL,
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "payslip_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_employee_id_date_key" ON "attendance"("employee_id", "date");

-- CreateIndex
CREATE INDEX "attendance_date_idx" ON "attendance"("date");

-- CreateIndex
CREATE INDEX "pay_advances_employee_id_idx" ON "pay_advances"("employee_id");

-- CreateIndex
CREATE INDEX "pay_advances_recovered_in_idx" ON "pay_advances"("recovered_in");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_period_key" ON "payroll_runs"("period");

-- CreateIndex
CREATE UNIQUE INDEX "payslip_lines_payroll_run_id_employee_id_key" ON "payslip_lines"("payroll_run_id", "employee_id");

-- CreateIndex
CREATE INDEX "payslip_lines_employee_id_idx" ON "payslip_lines"("employee_id");

-- AddForeignKey
ALTER TABLE "attendance"
    ADD CONSTRAINT "attendance_employee_id_fkey"
    FOREIGN KEY ("employee_id")
    REFERENCES "employees"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_advances"
    ADD CONSTRAINT "pay_advances_employee_id_fkey"
    FOREIGN KEY ("employee_id")
    REFERENCES "employees"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_advances"
    ADD CONSTRAINT "pay_advances_recovered_in_fkey"
    FOREIGN KEY ("recovered_in")
    REFERENCES "payroll_runs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip_lines"
    ADD CONSTRAINT "payslip_lines_payroll_run_id_fkey"
    FOREIGN KEY ("payroll_run_id")
    REFERENCES "payroll_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip_lines"
    ADD CONSTRAINT "payslip_lines_employee_id_fkey"
    FOREIGN KEY ("employee_id")
    REFERENCES "employees"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
