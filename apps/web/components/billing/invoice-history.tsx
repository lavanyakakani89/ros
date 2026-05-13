"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, MessageCircle, Pencil, Printer, Search, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { apiUrl, createAuthenticatedApiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { getStoredAuthSession, getStoredTenant } from "@/lib/vertical-config";
import { fetchWhatsappMessageTemplates, formatInvoiceRecordWhatsappMessage, getWhatsappTemplateBody, openWhatsappMessage } from "@/lib/whatsapp";

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  status: string;
  subtotal?: string | number;
  totalDiscount?: string | number;
  totalCgst?: string | number;
  totalSgst?: string | number;
  grandTotal: string | number;
  amountPaid?: string | number;
  amountDue: string | number;
  invoiceDate: string;
  dueDate?: string | null;
  paymentMode: string;
  notes?: string | null;
  verticalData?: Record<string, unknown> | null;
  customer?: {
    id: string;
    name: string;
    phone?: string | null;
    address?: string | null;
    creditLimit?: string | number | null;
    outstandingDue?: string | number | null;
  } | null;
  delivery?: {
    id?: string;
    status: string;
    deliveryAddress?: string | null;
    notes?: string | null;
  } | null;
  items?: Array<{
    id?: string;
    productId: string;
    productName: string;
    quantity: string | number;
    sellingPrice: string | number;
    discount: string | number;
    gstRate: string | number;
    total: string | number;
  }>;
}

interface InvoiceListResponse {
  data: InvoiceRecord[];
  page: number;
  limit: number;
  total: number;
}

export function InvoiceHistory({
  surface = "embedded",
  onEdit,
}: Readonly<{
  surface?: "embedded" | "drawer";
  onEdit?: ((invoice: InvoiceRecord) => void) | undefined;
}>) {
  const queryClient = useQueryClient();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const isDrawer = surface === "drawer";
  const canCancelInvoices = getStoredAuthSession()?.user?.role !== "STAFF";
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
  const whatsappTemplatesQuery = useQuery({
    queryKey: ["whatsapp-message-templates"],
    queryFn: fetchWhatsappMessageTemplates,
    staleTime: 60_000,
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

  async function printInvoice(invoice: InvoiceRecord) {
    setActionError(null);
    try {
      await createAuthenticatedApiClient().post(`/billing/invoices/${invoice.id}/pdf`, {});
      window.open(apiUrl(`/billing/invoices/${invoice.id}/pdf/view`), "_blank", "noopener,noreferrer");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to prepare invoice PDF.");
    }
  }

  function shareInvoiceWhatsApp(invoice: InvoiceRecord) {
    setActionError(null);
    if (!invoice.customer?.phone) {
      setActionError("Invoice does not have a customer phone number.");
      return;
    }

    const opened = openWhatsappMessage(
      invoice.customer.phone,
      formatInvoiceRecordWhatsappMessage(invoice, getStoredTenant()?.name ?? "RetailOS", getWhatsappTemplateBody(whatsappTemplatesQuery.data, "invoiceReady")),
    );
    if (!opened) {
      setActionError("Customer phone number is invalid for WhatsApp.");
    }
  }

  return (
    <section className={cn("flex min-h-0 flex-col bg-white", isDrawer ? "flex-1" : "max-h-[72vh] rounded-md border border-border")}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!isDrawer ? <div className="text-sm font-semibold text-slate-950">Invoice history</div> : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input value={from} onChange={(event) => resetPage(() => setFrom(event.target.value))} type="date" className="h-9 rounded-md border border-border px-2 text-sm" />
            <input value={to} onChange={(event) => resetPage(() => setTo(event.target.value))} type="date" className="h-9 rounded-md border border-border px-2 text-sm" />
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" aria-hidden="true" />
              <input value={search} onChange={(event) => resetPage(() => setSearch(event.target.value))} placeholder="Invoice or customer" className="h-9 w-56 rounded-md border border-border pl-9 pr-3 text-sm" />
            </label>
            <select value={status} onChange={(event) => resetPage(() => setStatus(event.target.value))} className="h-9 rounded-md border border-border px-2 text-sm">
              <option value="">All statuses</option>
              {["DRAFT", "CONFIRMED", "PAID", "PARTIAL", "CANCELLED"].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
        </div>
        {error || actionError ? <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError ?? error?.message}</div> : null}
      </div>

      <div className={cn("min-h-0 flex-1", isDrawer ? "grid lg:grid-cols-[minmax(0,1fr)_360px]" : "flex flex-col")}>
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[32%]" />
                <col className="w-[24%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead className="sticky top-0 z-[1] bg-slate-50 text-left text-xs text-slate-500 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-center font-medium">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invoices.length > 0 ? invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className={cn("cursor-pointer hover:bg-slate-50", selectedInvoice?.id === invoice.id && "bg-emerald-50/70")}
                    onClick={() => setSelectedInvoice(invoice)}
                  >
                    <td className="break-words px-3 py-3 font-mono text-xs leading-5">
                      <div>{invoice.invoiceNumber}</div>
                      {isWhatsappInvoice(invoice) ? (
                        <div className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          <MessageCircle className="size-3" aria-hidden="true" />
                          WhatsApp
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <div className="truncate">{invoice.customer?.name ?? "Walk-in"}</div>
                      <div className="truncate text-xs text-slate-400">{new Date(invoice.invoiceDate).toLocaleDateString("en-IN")}</div>
                    </td>
                    <td className="px-3 py-3"><StatusBadge status={invoice.status} /></td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">₹{Number(invoice.grandTotal).toFixed(2)}</td>
                    <td className="px-3 py-3 text-center" onClick={(event) => event.stopPropagation()}>
                        {onEdit ? (
                          <button className="inline-flex size-8 items-center justify-center rounded-md border border-emerald-200 text-emerald-700 hover:bg-emerald-50" title="Edit invoice" onClick={() => onEdit(invoice)}>
                            <Pencil className="size-4" aria-hidden="true" />
                          </button>
                        ) : null}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-500">No invoices for this filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border bg-white px-4 py-3 text-sm text-slate-600">
            <span>{total} invoices</span>
            <div className="flex items-center gap-2">
              <button className="h-8 rounded-md border border-border px-3 disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((value) => Math.max(value - 1, 1))}>Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button className="h-8 rounded-md border border-border px-3 disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(value + 1, totalPages))}>Next</button>
            </div>
          </div>
        </div>

        {isDrawer ? (
          <InvoiceDetailPanel invoice={selectedInvoice} onPrint={printInvoice} onShareWhatsapp={shareInvoiceWhatsApp} onEdit={onEdit} canCancel={canCancelInvoices} onCancel={(invoice) => cancelInvoice.mutate(invoice.id)} />
        ) : null}
      </div>
    </section>
  );
}

function InvoiceDetailPanel({
  invoice,
  onPrint,
  onShareWhatsapp,
  onEdit,
  canCancel,
  onCancel,
}: Readonly<{
  invoice: InvoiceRecord | null;
  onPrint: (invoice: InvoiceRecord) => void | Promise<void>;
  onShareWhatsapp: (invoice: InvoiceRecord) => void;
  onEdit?: ((invoice: InvoiceRecord) => void) | undefined;
  canCancel: boolean;
  onCancel: (invoice: InvoiceRecord) => void;
}>) {
  if (!invoice) {
    return (
      <aside className="hidden border-l border-border bg-slate-50 p-5 lg:flex lg:flex-col lg:items-center lg:justify-center">
        <div className="flex size-12 items-center justify-center rounded-md bg-white text-emerald-700 shadow-sm">
          <FileText className="size-6" aria-hidden="true" />
        </div>
        <div className="mt-3 text-sm font-semibold text-slate-900">Select an invoice</div>
        <p className="mt-1 max-w-56 text-center text-xs text-slate-500">Invoice lines, payment mode, delivery status, and print actions will appear here.</p>
      </aside>
    );
  }

  return (
    <aside className="min-h-0 border-l border-border bg-slate-50">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-xs text-slate-500">{invoice.invoiceNumber}</div>
              <div className="mt-1 text-lg font-bold text-slate-950">₹{Number(invoice.grandTotal).toFixed(2)}</div>
            </div>
            <StatusBadge status={invoice.status} />
          </div>
          <div className="mt-3 grid gap-1 text-xs text-slate-500">
            <div>{invoice.customer?.name ?? "Walk-in customer"}</div>
            {invoice.customer?.phone ? <div>{invoice.customer.phone}</div> : null}
            <div>{new Date(invoice.invoiceDate).toLocaleString("en-IN")}</div>
            <div>Payment: {invoice.paymentMode}</div>
            <div>Delivery: {invoice.delivery?.status ?? "Not required"}</div>
            {isWhatsappInvoice(invoice) ? <div className="font-medium text-emerald-700">Source: WhatsApp order</div> : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Line items</div>
          <div className="mt-2 divide-y divide-border rounded-md border border-border bg-white">
            {(invoice.items ?? []).length > 0 ? (invoice.items ?? []).map((item, index) => (
              <div key={`${item.productName}-${String(index)}`} className="flex justify-between gap-3 p-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{item.productName}</span>
                  <span className="text-xs text-slate-400">Qty {Number(item.quantity).toLocaleString("en-IN")}</span>
                </span>
                <span className="font-semibold">₹{Number(item.total).toFixed(2)}</span>
              </div>
            )) : (
              <div className="p-4 text-sm text-slate-500">No line details available.</div>
            )}
          </div>
        </div>

        <div className="grid gap-2 border-t border-border bg-white p-4">
          {onEdit ? (
            <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-800" onClick={() => onEdit(invoice)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit invoice
            </button>
          ) : null}
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white" onClick={() => void onPrint(invoice)}>
            <Printer className="size-4" aria-hidden="true" />
            Print PDF
          </button>
          {invoice.customer?.phone ? (
            <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 text-sm font-medium text-green-800" onClick={() => onShareWhatsapp(invoice)}>
              <MessageCircle className="size-4" aria-hidden="true" />
              Send WhatsApp
            </button>
          ) : null}
          {canCancel ? (
            <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 disabled:opacity-40" disabled={invoice.status === "CANCELLED"} onClick={() => onCancel(invoice)}>
              <XCircle className="size-4" aria-hidden="true" />
              Cancel invoice
            </button>
          ) : null}
        </div>
      </div>
    </aside>
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

function isWhatsappInvoice(invoice: InvoiceRecord): boolean {
  return invoice.verticalData?.source === "WHATSAPP" || typeof invoice.verticalData?.whatsappOrderId === "string";
}
