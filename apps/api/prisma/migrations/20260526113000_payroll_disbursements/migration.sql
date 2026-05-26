-- Connect payroll disbursements to payment methods so salary payouts appear in method ledgers.
CREATE TABLE "payroll_disbursements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payroll_run_id" TEXT NOT NULL,
    "payslip_line_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "payment_method_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference_number" VARCHAR(128),
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_by" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "void_authorised_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_disbursements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_disbursements_payslip_line_id_key" ON "payroll_disbursements"("payslip_line_id");
CREATE INDEX "payroll_disbursements_tenant_id_payroll_run_id_idx" ON "payroll_disbursements"("tenant_id", "payroll_run_id");
CREATE INDEX "payroll_disbursements_tenant_id_employee_id_idx" ON "payroll_disbursements"("tenant_id", "employee_id");
CREATE INDEX "payroll_disbursements_payment_method_id_paid_at_idx" ON "payroll_disbursements"("payment_method_id", "paid_at");

ALTER TABLE "payroll_disbursements" ADD CONSTRAINT "payroll_disbursements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_disbursements" ADD CONSTRAINT "payroll_disbursements_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_disbursements" ADD CONSTRAINT "payroll_disbursements_payslip_line_id_fkey" FOREIGN KEY ("payslip_line_id") REFERENCES "payslip_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_disbursements" ADD CONSTRAINT "payroll_disbursements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_disbursements" ADD CONSTRAINT "payroll_disbursements_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_disbursements" ADD CONSTRAINT "payroll_disbursements_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_disbursements" ADD CONSTRAINT "payroll_disbursements_void_authorised_by_fkey" FOREIGN KEY ("void_authorised_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
