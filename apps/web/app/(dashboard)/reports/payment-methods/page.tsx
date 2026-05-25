import { PaymentMethodsReport } from "@/components/reports/payment-methods-report";
import { PageHeader } from "@/components/shared/page-header";

export default function PaymentMethodsReportPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Reports" title="Payment method statements" subtitle="Review sales, voids, references, and running balance by method." />
      <PaymentMethodsReport />
    </div>
  );
}
