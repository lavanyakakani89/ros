"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Printer, X, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { apiUrl, createAuthenticatedApiClient } from "@/lib/api-client";

interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  status: string;
  grandTotal: string | number;
  amountDue: string | number;
  invoiceDate: string;
  paymentMode: string;
  customer?: {
    name: string;
    phone?: string | null;
  } | null;
  delivery?: {
    status: string;
  } | null;
  items?: Array<{
    productName: string;
    quantity: string | number;
    total: string | number;
  }>;
}

interface InvoiceListResponse {
  data: InvoiceRecord[];
  page: number;
  limit: number;
  total: number;
}

export function InvoiceHistory() {
  const queryClient = useQueryClient();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: "10",
      from,
      to,
    });
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    return params.toString();
  }, [from, page, search, status, to]);

  const invoicesQuery = useQuery({
    queryKey: ["invoices", query],
    queryFn: () => createAuthenticatedApiClient().get<InvoiceListResponse>(`/billing/invoices?${query}`),
  });
  const cancelInvoice = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post(`/billing/invoices/${id}/cancel`, {}),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["invoices"] }),
  });
  const invoices = invoicesQuery.data?.data ?? [];
  const total = invoicesQuery.data?.total ?? 0;
  const totalPages = Math.max(Math.ceil(total / 10), 1);
  const error = invoicesQuery.error ?? cancelInvoice.error;

  function resetPage(action: () => void) {
    action();
    setPage(1);
  }

  return (
    <section className="rounded-md border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="text-sm font-semibold text-slate-950">Invoice history</div>
        <div className="flex flex-wrap gap-2">
          <input value={from} onChange={(event) => resetPage(() => setFrom(event.target.value))} type="date" className="h-9 rounded-md border border-border px-2 text-sm" />
          <input value={to} onChange={(event) => resetPage(() => setTo(event.target.value))} type="date" className="h-9 rounded-md border border-border px-2 text-sm" />
          <input value={search} onChange={(event) => resetPage(() => setSearch(event.target.value))} placeholder="Invoice or customer" className="h-9 rounded-md border border-border px-3 text-sm" />
          <select value={status} onChange={(event) => resetPage(() => setStatus(event.target.value))} className="h-9 rounded-md border border-border px-2 text-sm">
            <option value="">All statuses</option>
            {["DRAFT", "CONFIRMED", "PAID", "PARTIAL", "CANCELLED"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
      </div>
      {error ? <div className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Invoice</th>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Delivery</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invoices.length > 0 ? invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="px-4 py-3 font-mono text-xs">{invoice.invoiceNumber}</td>
                <td className="px-4 py-3">{invoice.customer?.name ?? "Walk-in"}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{new Date(invoice.invoiceDate).toLocaleDateString("en-IN")}</td>
                <td className="px-4 py-3"><StatusBadge status={invoice.status} /></td>
                <td className="px-4 py-3 text-xs text-slate-500">{invoice.delivery?.status ?? "-"}</td>
                <td className="px-4 py-3 text-right font-semibold">₹{Number(invoice.grandTotal).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-slate-700" onClick={() => setSelectedInvoice(invoice)}>
                      <Eye className="size-4" aria-hidden="true" />
                      View
                    </button>
                    <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-slate-700" onClick={() => window.open(apiUrl(`/billing/invoices/${invoice.id}/pdf/view`), "_blank")}>
                      <Printer className="size-4" aria-hidden="true" />
                      Print
                    </button>
                    <button className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm text-red-700" disabled={invoice.status === "CANCELLED"} onClick={() => cancelInvoice.mutate(invoice.id)}>
                      <XCircle className="size-4" aria-hidden="true" />
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">No invoices for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-slate-600">
        <span>{total} invoices</span>
        <div className="flex items-center gap-2">
          <button className="h-8 rounded-md border border-border px-3 disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((value) => Math.max(value - 1, 1))}>Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button className="h-8 rounded-md border border-border px-3 disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(value + 1, totalPages))}>Next</button>
        </div>
      </div>

      {selectedInvoice ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <section className="w-full max-w-2xl rounded-md border border-border bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-border p-4">
              <div>
                <div className="text-sm font-semibold text-slate-950">{selectedInvoice.invoiceNumber}</div>
                <div className="text-xs text-slate-500">{selectedInvoice.customer?.name ?? "Walk-in"} | {selectedInvoice.paymentMode}</div>
              </div>
              <button className="inline-flex size-9 items-center justify-center rounded-md hover:bg-slate-100" onClick={() => setSelectedInvoice(null)}>
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-4">
              <div className="mb-3 flex items-center justify-between">
                <StatusBadge status={selectedInvoice.status} />
                <div className="text-lg font-bold text-slate-950">₹{Number(selectedInvoice.grandTotal).toFixed(2)}</div>
              </div>
              <div className="divide-y divide-border rounded-md border border-border">
                {(selectedInvoice.items ?? []).map((item, index) => (
                  <div key={`${item.productName}-${index}`} className="flex justify-between gap-3 p-3 text-sm">
                    <span>{item.productName} × {Number(item.quantity).toLocaleString("en-IN")}</span>
                    <span className="font-semibold">₹{Number(item.total).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border p-4">
              <button className="h-9 rounded-md border border-border px-3 text-sm text-slate-700" onClick={() => window.open(apiUrl(`/billing/invoices/${selectedInvoice.id}/pdf/view`), "_blank")}>Print</button>
              <button className="h-9 rounded-md bg-slate-900 px-3 text-sm text-white" onClick={() => setSelectedInvoice(null)}>Close</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function StatusBadge({ status }: Readonly<{ status: string }>) {
  const className = statusClass(status);
  return <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${className}`}>{status}</span>;
}

function statusClass(status: string): string {
  if (status === "PAID") return "bg-emerald-50 text-emerald-700";
  if (status === "PARTIAL" || status === "CONFIRMED") return "bg-amber-50 text-amber-800";
  if (status === "CANCELLED") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-600";
}
