import { Plus, Receipt } from "lucide-react";

import { PosInvoicePanel } from "@/components/billing/pos-invoice-panel";
import { PageHeader } from "@/components/shared/page-header";
import { StatStrip } from "@/components/shared/stat-strip";

export default function BillingPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Point of sale"
        title="New GST invoice"
        actions={
          <>
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white">
              <Receipt className="size-4" aria-hidden="true" />
              Hold bill
            </button>
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white">
              <Plus className="size-4" aria-hidden="true" />
              Add item
            </button>
          </>
        }
      />
      <StatStrip
        items={[
          { label: "Today sales", value: "₹18,420", tone: "emerald" },
          { label: "Open bills", value: "7", tone: "blue" },
          { label: "Offline queue", value: "0", tone: "slate" },
          { label: "Due today", value: "₹2,310", tone: "amber" },
        ]}
      />
      <PosInvoicePanel />
    </div>
  );
}
