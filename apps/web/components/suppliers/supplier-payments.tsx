"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";

interface SupplierPaymentRecord {
  id: string;
  amount: number | string;
  mode: string;
  note?: string | null;
  createdAt: string;
}

interface SupplierPaymentsData {
  supplier: { id: string; name: string; phone?: string | null };
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  payments: SupplierPaymentRecord[];
}

const MODES = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD"];

export function SupplierPayments({ supplierId }: { supplierId: string }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("CASH");
  const [note, setNote] = useState("");

  const dataQuery = useQuery({
    queryKey: ["supplier-payments", supplierId],
    queryFn: () => createAuthenticatedApiClient().get<SupplierPaymentsData>(`/suppliers/${supplierId}/payments`),
  });

  const addPayment = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post(`/suppliers/${supplierId}/payments`, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["supplier-payments", supplierId] });
      setAmount(""); setNote("");
    },
  });

  const data = dataQuery.data;
  if (dataQuery.isLoading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  if (!data) return <div className="p-6 text-sm text-slate-400">Supplier not found.</div>;

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!amount) return;
    addPayment.mutate({ amount: Number(amount), mode, note: note || undefined });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/suppliers" className="text-slate-400 hover:text-slate-700"><ArrowLeft className="size-5" /></Link>
        <div>
          <h1 className="text-xl font-bold text-slate-950">{data.supplier.name}</h1>
          <div className="text-xs text-slate-500">Accounts Payable Ledger</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Billed", value: data.totalBilled, color: "text-slate-900" },
          { label: "Total Paid", value: data.totalPaid, color: "text-emerald-700" },
          { label: "Outstanding (AP)", value: data.outstanding, color: data.outstanding > 0 ? "text-red-600" : "text-emerald-700" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-md border border-border bg-white p-3">
            <div className="text-xs text-slate-500">{stat.label}</div>
            <div className={`mt-1 text-lg font-bold ${stat.color}`}>
              INR {stat.value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Record payment</div>
        <div className="flex flex-wrap gap-3">
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (INR)" min="0.01" step="0.01" required className="h-10 w-40 rounded-md border border-border px-3 text-sm" />
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="h-10 rounded-md border border-border px-3 text-sm">
            {MODES.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-10 flex-1 min-w-[160px] rounded-md border border-border px-3 text-sm" />
          <button type="submit" disabled={addPayment.isPending} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">
            <Plus className="size-4" />Record
          </button>
        </div>
      </form>

      <div className="rounded-md border border-border bg-white">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Payment history</div>
        {data.payments.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">No payments recorded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Mode</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-left font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 text-xs text-slate-500">{new Date(p.createdAt).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-2"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{p.mode}</span></td>
                  <td className="px-4 py-2 text-right font-medium text-emerald-700">INR {Number(p.amount).toFixed(2)}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{p.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
