import { PayrollClient } from "@/components/payroll/payroll-client";
import { PageHeader } from "@/components/shared/page-header";

export default function PayrollPage() {
  return (
    <>
      <PageHeader eyebrow="People" title="Payroll" subtitle="Employees, attendance, payroll runs, payslips, and salary disbursements." />
      <PayrollClient />
    </>
  );
}
