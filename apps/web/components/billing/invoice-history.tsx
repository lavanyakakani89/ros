"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, XCircle } from "lucide-react";

import { createAuthenticatedApiClient } from "@/lib/api-client";

interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  status: string;
  grandTotal: string | number;
  amountDue: string | number;
  invoiceDate: string;
  customer?: {
    name: string;
  } | null;
}

export function InvoiceHistory() {
  const queryClient = useQueryClient();
  const invoicesQuery = useQuery({
    queryKey: ["invoices"],
    queryFn: () => createAuthenticatedApiClient().get<{ data: InvoiceRecord[] }>("/billing/invoices?limit=50"),
  });
  const cancelInvoice = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post(`/billing/invoices/${id}/cancel`, {}),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["invoices"] }),
  });
  const generatePdf = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post<{ downloadUrl: string }>(`/billing/invoices/${id}/pdf`, {}),
    onSuccess: (pdf) => window.open(pdf.downloadUrl, "_blank"),
  });
  const invoices = invoicesQuery.data?.data ?? [];
  const error = invoicesQuery.error ?? cancelInvoice.error ?? generatePdf.error;

  return (
    <section className="rounded-md border border-border bg-white">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Invoice history</div>
      {error ? <div className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
      <div className="divide-y divide-border">
        {invoices.length > 0 ? invoices.map((invoice) => (
          <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-sm font-medium text-slate-950">{invoice.invoiceNumber}</div>
              <div className="text-xs text-slate-500">{invoice.customer?.name ?? "Walk-in"} | {invoice.status} | {new Date(invoice.invoiceDate).toLocaleDateString("en-IN")}</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-slate-900">INR {Number(invoice.grandTotal).toFixed(2)}</div>
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-slate-700" onClick={() => generatePdf.mutate(invoice.id)}>
                <Printer className="size-4" aria-hidden="true" />
                PDF
              </button>
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm text-red-700" disabled={invoice.status === "CANCELLED"} onClick={() => cancelInvoice.mutate(invoice.id)}>
                <XCircle className="size-4" aria-hidden="true" />
                Cancel
              </button>
            </div>
          </div>
        )) : <div className="p-4 text-sm text-slate-500">No invoices yet.</div>}
      </div>
    </section>
  );
}
