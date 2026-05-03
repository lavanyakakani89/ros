"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { createAuthenticatedApiClient, listProducts } from "@/lib/api-client";

interface Quotation {
  id: string;
  quotationNumber: string;
  status: string;
  grandTotal: string | number;
  validUntil?: string | null;
  createdAt: string;
  customer?: { name: string } | null;
  items: Array<{ productName: string; quantity: number | string; sellingPrice: number | string; total: number | string }>;
}

export function QuotationsClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ productId: "", productName: "", quantity: 1, unit: "piece", sellingPrice: 0, discount: 0, gstRate: 0 }]);

  const quotationsQuery = useQuery({
    queryKey: ["quotations"],
    queryFn: () => createAuthenticatedApiClient().get<{ data: Quotation[] }>("/quotations"),
  });
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: () => listProducts() });
  const customersQuery = useQuery({
    queryKey: ["customers", "quotations", customerSearch],
    queryFn: () => createAuthenticatedApiClient().get<{ data: Array<{ id: string; name: string; phone: string }> }>(`/customers?limit=20${customerSearch ? `&search=${encodeURIComponent(customerSearch)}` : ""}`),
  });
  const createQuotation = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/quotations", payload),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["quotations"] }); setShowForm(false); },
  });
  const convertToInvoice = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post<{ suggestedPayload: object }>(`/quotations/${id}/convert`, {}),
    onSuccess: () => router.push("/billing"),
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => createAuthenticatedApiClient().put(`/quotations/${id}/status`, { status }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["quotations"] }),
  });

  const quotations = quotationsQuery.data?.data ?? [];
  const products = productsQuery.data?.data ?? [];

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const items = lines.filter((l) => l.productName.trim() || l.productId);
    if (items.length === 0) return;
    createQuotation.mutate({
      customerId: customerId || undefined,
      validUntil: validUntil || undefined,
      notes: notes || undefined,
      items: items.map((l) => ({ productId: l.productId || undefined, productName: l.productName, quantity: l.quantity, unit: l.unit, sellingPrice: l.sellingPrice, discount: l.discount, gstRate: l.gstRate })),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-950">Quotations / Estimates</h1>
        <button onClick={() => setShowForm((v) => !v)} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white">
          <Plus className="size-4" />New quotation
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-md border border-border bg-white p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-950">New quotation</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search customer" className="h-10 rounded-md border border-border px-3 text-sm" />
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-10 rounded-md border border-border px-3 text-sm">
              <option value="">Walk-in / No customer</option>
              {(customersQuery.data?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} | {c.phone}</option>)}
            </select>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} placeholder="Valid until" className="h-10 rounded-md border border-border px-3 text-sm" />
          </div>
          {lines.map((line, idx) => (
            <div key={idx} className="flex flex-wrap gap-2">
              <select className="h-9 flex-1 min-w-[160px] rounded-md border border-border px-2 text-sm" value={line.productId}
                onChange={(e) => {
                  const p = products.find((pr) => pr.id === e.target.value);
                  setLines((prev) => prev.map((l, i) => i === idx ? { ...l, productId: e.target.value, productName: p?.name ?? "", sellingPrice: Number(p?.sellingPrice ?? 0), gstRate: Number(p?.gstRate ?? 0), unit: p?.unit ?? "piece" } : l));
                }}>
                <option value="">Select product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input value={line.productName} onChange={(e) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, productName: e.target.value } : l))} placeholder="Item name" className="h-9 w-36 rounded-md border border-border px-2 text-sm" />
              <input type="number" value={line.quantity} min="0.001" step="0.001" onChange={(e) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, quantity: Number(e.target.value) } : l))} className="h-9 w-20 rounded-md border border-border px-2 text-sm" />
              <input type="number" value={line.sellingPrice} min="0" onChange={(e) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, sellingPrice: Number(e.target.value) } : l))} placeholder="Price" className="h-9 w-24 rounded-md border border-border px-2 text-sm" />
              <input type="number" value={line.discount} min="0" onChange={(e) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, discount: Number(e.target.value) } : l))} placeholder="Discount" className="h-9 w-20 rounded-md border border-border px-2 text-sm" />
              {idx > 0 && <button type="button" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} className="text-red-500 px-2">✕</button>}
            </div>
          ))}
          <button type="button" onClick={() => setLines((p) => [...p, { productId: "", productName: "", quantity: 1, unit: "piece", sellingPrice: 0, discount: 0, gstRate: 0 }])} className="text-sm text-emerald-700">+ Add line</button>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="h-9 w-full rounded-md border border-border px-3 text-sm" />
          <button type="submit" disabled={createQuotation.isPending} className="h-10 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">
            {createQuotation.isPending ? "Creating…" : "Create quotation"}
          </button>
        </form>
      )}

      <div className="rounded-md border border-border bg-white">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Quotations</div>
        {quotations.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">No quotations yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Number</th>
                  <th className="px-4 py-2 text-left font-medium">Customer</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Valid Until</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {quotations.map((q) => (
                  <tr key={q.id}>
                    <td className="px-4 py-2 font-mono text-xs">{q.quotationNumber}</td>
                    <td className="px-4 py-2">{q.customer?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-medium">INR {Number(q.grandTotal).toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <select value={q.status} onChange={(e) => updateStatus.mutate({ id: q.id, status: e.target.value })}
                        className="h-7 rounded-md border border-border px-2 text-xs">
                        {["DRAFT", "SENT", "ACCEPTED", "REJECTED", "CONVERTED"].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{q.validUntil ? new Date(q.validUntil).toLocaleDateString("en-IN") : "—"}</td>
                    <td className="px-4 py-2 text-right">
                      {q.status !== "CONVERTED" && (
                        <button onClick={() => convertToInvoice.mutate(q.id)} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          Convert <ArrowRight className="size-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
