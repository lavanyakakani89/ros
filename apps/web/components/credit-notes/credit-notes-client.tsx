"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { PaginationControls } from "@/components/shared/pagination-controls";
import { createAuthenticatedApiClient, listAllProducts, type PaginatedResponse } from "@/lib/api-client";
import { appendDateRange, defaultFromDate, todayDate } from "@/lib/date-range";

interface CreditNote {
  id: string;
  creditNoteNumber: string;
  status: string;
  grandTotal: string | number;
  reason?: string | null;
  createdAt: string;
  customer?: { name: string; phone: string } | null;
  items: Array<{ productName: string; quantity: number | string; total: number | string }>;
}

export function CreditNotesClient() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [originalInvoiceId, setOriginalInvoiceId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState([{ productId: "", quantity: 1, discount: 0 }]);
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState(() => defaultFromDate(30));
  const [to, setTo] = useState(() => todayDate());
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const cnQuery = useQuery({
    queryKey: ["credit-notes", status, from, to, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (status) params.set("status", status);
      appendDateRange(params, from, to);
      return createAuthenticatedApiClient().get<PaginatedResponse<CreditNote>>(`/credit-notes?${params.toString()}`);
    },
  });
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: () => listAllProducts() });
  const createCn = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/credit-notes", payload),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["credit-notes"] }); setShowForm(false); setLines([{ productId: "", quantity: 1, discount: 0 }]); },
  });
  const confirmCn = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post(`/credit-notes/${id}/confirm`, {}),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["credit-notes"] }),
  });

  const creditNotes = cnQuery.data?.data ?? [];
  const products = productsQuery.data?.data ?? [];
  useEffect(() => {
    setPage(1);
  }, [status, from, to]);

  function handleCreate(e: React.SyntheticEvent) {
    e.preventDefault();
    const items = lines.filter((l) => l.productId);
    if (items.length === 0) return;
    createCn.mutate({ originalInvoiceId: originalInvoiceId || undefined, reason: reason || undefined, items });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-950">Credit Notes / Sales Returns</h1>
        <button onClick={() => setShowForm((v) => !v)} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white">
          <Plus className="size-4" />New credit note
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-md border border-border bg-white p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-950">New credit note</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={originalInvoiceId} onChange={(e) => setOriginalInvoiceId(e.target.value)} placeholder="Original invoice ID (optional)" className="h-10 rounded-md border border-border px-3 text-sm" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for return" className="h-10 rounded-md border border-border px-3 text-sm" />
          </div>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="flex gap-2">
                <select value={line.productId} onChange={(e) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, productId: e.target.value } : l))}
                  className="h-9 flex-1 rounded-md border border-border px-2 text-sm">
                  <option value="">Select product</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(e) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, quantity: Number(e.target.value) } : l))}
                  className="h-9 w-24 rounded-md border border-border px-2 text-sm" placeholder="Qty" />
                <input type="number" min="0" value={line.discount} onChange={(e) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, discount: Number(e.target.value) } : l))}
                  className="h-9 w-24 rounded-md border border-border px-2 text-sm" placeholder="Discount" />
                {idx > 0 && <button type="button" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} className="text-red-500 text-sm px-2">✕</button>}
              </div>
            ))}
            <button type="button" onClick={() => setLines((prev) => [...prev, { productId: "", quantity: 1, discount: 0 }])} className="text-sm text-emerald-700">+ Add line</button>
          </div>
          <button type="submit" disabled={createCn.isPending} className="h-10 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">
            {createCn.isPending ? "Creating…" : "Create credit note"}
          </button>
        </form>
      )}

      <div className="rounded-md border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-slate-950">Credit notes</div>
          <div className="flex flex-wrap gap-2">
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm" />
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm" />
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm">
              <option value="">All statuses</option>
              {["DRAFT", "CONFIRMED", "CANCELLED"].map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        </div>
        {creditNotes.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">No credit notes yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Number</th>
                  <th className="px-4 py-2 text-left font-medium">Customer</th>
                  <th className="px-4 py-2 text-left font-medium">Reason</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {creditNotes.map((cn) => (
                  <tr key={cn.id}>
                    <td className="px-4 py-2 font-mono text-xs">{cn.creditNoteNumber}</td>
                    <td className="px-4 py-2">{cn.customer?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-500">{cn.reason ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-medium">₹{Number(cn.grandTotal).toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cn.status === "CONFIRMED" ? "bg-emerald-100 text-emerald-700" : cn.status === "CANCELLED" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                        {cn.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{new Date(cn.createdAt).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-2 text-right">
                      {cn.status === "DRAFT" && (
                        <button onClick={() => confirmCn.mutate(cn.id)} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                          <CheckCircle className="size-3" />Confirm
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationControls page={page} limit={pageSize} total={cnQuery.data?.total ?? 0} onPageChange={setPage} />
      </div>
    </div>
  );
}
