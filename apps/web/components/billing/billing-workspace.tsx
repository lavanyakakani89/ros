"use client";

import { PosInvoicePanel } from "@/components/billing/pos-invoice-panel";
import { PageHeader } from "@/components/shared/page-header";

export function BillingWorkspace() {
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Point of sale" title="New invoice" />
      <PosInvoicePanel />
    </div>
  );
}
