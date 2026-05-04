"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { createAuthenticatedApiClient } from "@/lib/api-client";

interface LedgerEntry {
  id: string;
  invoiceNumber?: string;
  date: string;
  type: "invoice" | "payment";
  amount: number;
  balance: number;
  notes?: string | null;
}

interface LedgerSummary {
  customer: { id: string; name: string; phone: string; creditLimit?: number | null };
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  entries: LedgerEntry[];
}

export function CustomerLedger({ customerId }: { customerId: string }) {
  const ledgerQuery = useQuery({
    queryKey: ["customer-ledger", customerId],
    queryFn: () => createAuthenticatedApiClient().get<LedgerSummary>(`/billing/customer-ledger/${customerId}`),
  });

  const data = ledgerQuery.data;

  if (ledgerQuery.isLoading) return <div className="p-6 text-sm text-slate-500">Loading ledger…</div>;
  if (!data) return <div className="p-6 text-sm text-slate-400">Customer not found.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/customers" className="text-slate-400 hover:text-slate-700"><ArrowLeft className="size-5" /></Link>
        <div>
          <h1 className="text-xl font-bold text-slate-950">{data.customer.name}</h1>
          <div className="text-xs text-slate-500">{data.customer.phone}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Billed", value: data.totalBilled, color: "text-slate-900" },
          { label: "Total Paid", value: data.totalPaid, color: "text-emerald-700" },
          { label: "Outstanding", value: data.outstanding, color: data.outstanding > 0 ? "text-red-600" : "text-slate-900" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-md border border-border bg-white p-3">
            <div className="text-xs text-slate-500">{stat.label}</div>
            <div className={`mt-1 text-lg font-bold ${stat.color}`}>
              ₹{stat.value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        ))}
      </div>

      {data.customer.creditLimit != null && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Credit limit: ₹{data.customer.creditLimit.toLocaleString("en-IN")}
          {data.outstanding > data.customer.creditLimit && (
            <span className="ml-2 font-semibold text-red-700">— LIMIT EXCEEDED</span>
          )}
        </div>
      )}

      <div className="rounded-md border border-border bg-white">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Transaction history</div>
        {data.entries.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">No transactions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Reference</th>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2 text-xs text-slate-500">{new Date(entry.date).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-2 font-mono text-xs">{entry.invoiceNumber ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        entry.type === "invoice" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"
                      }`}>
                        {entry.type === "invoice" ? "Invoice" : "Payment"}
                      </span>
                    </td>
                    <td className={`px-4 py-2 text-right text-xs font-medium ${entry.type === "payment" ? "text-emerald-700" : "text-slate-900"}`}>
                      {entry.type === "payment" ? "−" : "+"}₹{entry.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`px-4 py-2 text-right text-xs font-semibold ${entry.balance > 0 ? "text-red-600" : "text-slate-500"}`}>
                      ₹{entry.balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
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
