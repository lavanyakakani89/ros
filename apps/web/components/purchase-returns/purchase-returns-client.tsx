"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { PaginationControls } from "@/components/shared/pagination-controls";
import { createAuthenticatedApiClient, listAllProducts, type PaginatedResponse } from "@/lib/api-client";
import { appendDateRange, defaultFromDate, todayDate } from "@/lib/date-range";

interface PurchaseReturn {
  id: string;
  returnNumber: string;
  status: string;
  totalAmount: number | string;
  reason?: string | null;
  createdAt: string;
  supplier?: { name: string } | null;
  items: Array<{ productName: string; quantity: number | string; purchasePrice: number | string }>;
}

export function PurchaseReturnsClient() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState([{ productId: "", productName: "", quantity: 1, purchasePrice: 0 }]);
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState(() => defaultFromDate(30));
  const [to, setTo] = useState(() => todayDate());
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const returnsQuery = useQuery({
    queryKey: ["purchase-returns", status, from, to, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (status) params.set("status", status);
      appendDateRange(params, from, to);
      return createAuthenticatedApiClient().get<PaginatedResponse<PurchaseReturn>>(`/purchase-returns?${params.toString()}`);
    },
  });
  const suppliersQuery = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => createAuthenticatedApiClient().get<{ data: Array<{ id: string; name: string }> }>("/suppliers?limit=100"),
  });
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: () => listAllProducts() });

  const createReturn = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/purchase-returns", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchase-returns"] });
      setShowForm(false);
      setLines([{ productId: "", productName: "", quantity: 1, purchasePrice: 0 }]);
      setReason(""); setSupplierId("");
    },
  });
  const confirmReturn = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post(`/purchase-returns/${id}/confirm`, {}),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["purchase-returns"] }),
  });

  const returns = returnsQuery.data?.data ?? [];
  const suppliers = suppliersQuery.data?.data ?? [];
  const products = productsQuery.data?.data ?? [];
  useEffect(() => {
    setPage(1);
  }, [status, from, to]);

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const items = lines.filter((l) => l.productName.trim() || l.productId);
    if (items.length === 0) return;
    createReturn.mutate({
      supplierId: supplierId || undefined,
      reason: reason || undefined,
      items: items.map((l) => ({ productId: l.productId || undefined, productName: l.productName, quantity: l.quantity, purchasePrice: l.purchasePrice })),
    });
  }

  function statusColor(status: string) {
    if (status === "CONFIRMED") return "bg-emerald-50 text-emerald-700";
    if (status === "CANCELLED") return "bg-red-50 text-red-700";
    return "bg-amber-50 text-amber-700";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-950">Purchase Returns / Debit Notes</h1>
        <button onClick={() => setShowForm((v) => !v)} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white">
          <Plus className="size-4" />New return
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-md border border-border bg-white p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-950">New purchase return</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="h-10 rounded-md border border-border px-3 text-sm">
              <option value="">Select supplier (optional)</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for return" className="h-10 rounded-md border border-border px-3 text-sm" />
          </div>
          {lines.map((line, idx) => (
            <div key={idx} className="flex flex-wrap gap-2">
              <select className="h-9 flex-1 min-w-[160px] rounded-md border border-border px-2 text-sm" value={line.productId}
                onChange={(e) => {
                  const p = products.find((pr) => pr.id === e.target.value);
                  setLines((prev) => prev.map((l, i) => i === idx ? { ...l, productId: e.target.value, productName: p?.name ?? "", purchasePrice: Number(p?.purchasePrice ?? 0) } : l));
                }}>
                <option value="">Select product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input value={line.productName} onChange={(e) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, productName: e.target.value } : l))} placeholder="Item name" className="h-9 w-36 rounded-md border border-border px-2 text-sm" />
              <input type="number" value={line.quantity} min="0.001" step="0.001" onChange={(e) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, quantity: Number(e.target.value) } : l))} className="h-9 w-20 rounded-md border border-border px-2 text-sm" />
              <input type="number" value={line.purchasePrice} min="0" onChange={(e) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, purchasePrice: Number(e.target.value) } : l))} placeholder="Purchase price" className="h-9 w-28 rounded-md border border-border px-2 text-sm" />
              {idx > 0 && <button type="button" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} className="text-red-500 px-2">✕</button>}
            </div>
          ))}
          <button type="button" onClick={() => setLines((p) => [...p, { productId: "", productName: "", quantity: 1, purchasePrice: 0 }])} className="text-sm text-emerald-700">+ Add line</button>
          <button type="submit" disabled={createReturn.isPending} className="h-10 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">
            {createReturn.isPending ? "Creating…" : "Create return"}
          </button>
        </form>
      )}

      <div className="rounded-md border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-slate-950">Purchase returns</div>
          <div className="flex flex-wrap gap-2">
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm" />
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm" />
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm">
              <option value="">All statuses</option>
              {["DRAFT", "CONFIRMED", "CANCELLED"].map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        </div>
        {returns.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">No purchase returns yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Return #</th>
                  <th className="px-4 py-2 text-left font-medium">Supplier</th>
                  <th className="px-4 py-2 text-left font-medium">Reason</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {returns.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 font-mono text-xs">{r.returnNumber}</td>
                    <td className="px-4 py-2 text-xs">{r.supplier?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{r.reason ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-medium">₹{Number(r.totalAmount).toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(r.status)}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.status === "DRAFT" && (
                        <button onClick={() => confirmReturn.mutate(r.id)} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          Confirm
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationControls page={page} limit={pageSize} total={returnsQuery.data?.total ?? 0} onPageChange={setPage} />
      </div>
    </div>
  );
}
