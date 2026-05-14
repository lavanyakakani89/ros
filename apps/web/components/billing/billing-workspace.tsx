"use client";

import { History, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { InvoiceHistory, type InvoiceRecord } from "@/components/billing/invoice-history";
import { PosInvoicePanel } from "@/components/billing/pos-invoice-panel";
import { PageHeader } from "@/components/shared/page-header";
import { createAuthenticatedApiClient } from "@/lib/api-client";

export function BillingWorkspace() {
  const searchParams = useSearchParams();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRecord | null>(null);

  useEffect(() => {
    const invoiceId = searchParams.get("invoiceId");
    if (!invoiceId) {
      return;
    }

    let active = true;
    createAuthenticatedApiClient().get<InvoiceRecord>(`/billing/invoices/${invoiceId}`).then((invoice) => {
      if (active) {
        setEditingInvoice(invoice);
      }
    }).catch(() => null);

    return () => {
      active = false;
    };
  }, [searchParams]);

  function startEditingInvoice(invoice: InvoiceRecord) {
    setEditingInvoice(invoice);
    setHistoryOpen(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          eyebrow="Point of sale"
          title={editingInvoice ? "Edit invoice" : "New invoice"}
          subtitle={editingInvoice ? `${editingInvoice.invoiceNumber} | ${editingInvoice.status}` : undefined}
        />
        <button
          className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="size-4" aria-hidden="true" />
          Invoice History
        </button>
      </div>
      <PosInvoicePanel editingInvoice={editingInvoice} onEditComplete={() => setEditingInvoice(null)} onDraftReady={setEditingInvoice} />

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45">
          <button className="hidden flex-1 cursor-default lg:block" aria-label="Close invoice history" onClick={() => setHistoryOpen(false)} />
          <aside className="flex h-full w-full max-w-[980px] flex-col border-l border-border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <div className="text-base font-semibold text-slate-950">Invoice History</div>
                <div className="text-xs text-slate-500">Search bills, edit details, print PDFs, and cancel invoices.</div>
              </div>
              <button className="inline-flex size-9 items-center justify-center rounded-md hover:bg-slate-100" onClick={() => setHistoryOpen(false)}>
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <InvoiceHistory surface="drawer" onEdit={startEditingInvoice} />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
