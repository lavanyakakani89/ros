import { PaymentsClient } from "@/components/payments/payments-client";
import { PageHeader } from "@/components/shared/page-header";

export default function PaymentsPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Payments" title="Collections" />
      <PaymentsClient />
    </div>
  );
}
