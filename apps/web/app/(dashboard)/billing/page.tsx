import { PosInvoicePanel } from "@/components/billing/pos-invoice-panel";
import { PageHeader } from "@/components/shared/page-header";

export default function BillingPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Point of sale" title="New GST invoice" />
      <PosInvoicePanel />
    </div>
  );
}
