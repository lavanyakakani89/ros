"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PaginationControls } from "@/components/shared/pagination-controls";
import { createAuthenticatedApiClient } from "@/lib/api-client";
import { appendDateRange, defaultFromDate, todayDate } from "@/lib/date-range";

interface LedgerEntry {
  id: string;
  invoiceNumber?: string;
  date: string;
  type: "invoice" | "payment";
  amount: number | string | null | undefined;
  balance: number | string | null | undefined;
  notes?: string | null;
}

interface LedgerSummary {
  customer: { id: string; name: string; phone: string; creditLimit?: number | string | null };
  totalBilled: number | string | null | undefined;
  totalPaid: number | string | null | undefined;
  outstanding?: number | string | null | undefined;
  outstandingDue?: number | string | null | undefined;
  entries?: LedgerEntry[];
  page?: number;
  limit?: number;
  total?: number;
}

export function CustomerLedger({ customerId }: { customerId: string }) {
  const [from, setFrom] = useState(() => defaultFromDate(30));
  const [to, setTo] = useState(() => todayDate());
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const ledgerQuery = useQuery({
    queryKey: ["customer-ledger", customerId, from, to, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      appendDateRange(params, from, to);
      return createAuthenticatedApiClient().get<LedgerSummary>(`/billing/customer-ledger/${customerId}?${params.toString()}`);
    },
  });
  useEffect(() => {
    setPage(1);
  }, [from, to]);

  const data = ledgerQuery.data;
  const outstanding = toMoneyNumber(data?.outstanding ?? data?.outstandingDue);
  const entries = data?.entries ?? [];
  const creditLimit = data?.customer.creditLimit == null ? null : toMoneyNumber(data.customer.creditLimit);

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
          { label: "Total Billed", value: toMoneyNumber(data.totalBilled), color: "text-slate-900" },
          { label: "Total Paid", value: toMoneyNumber(data.totalPaid), color: "text-emerald-700" },
          { label: "Outstanding", value: outstanding, color: outstanding > 0 ? "text-red-600" : "text-slate-900" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-md border border-border bg-white p-3">
            <div className="text-xs text-slate-500">{stat.label}</div>
            <div className={`mt-1 text-lg font-bold ${stat.color}`}>
              {money(stat.value)}
            </div>
          </div>
        ))}
      </div>

      {creditLimit != null && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Credit limit: {money(creditLimit)}
          {outstanding > creditLimit && (
            <span className="ml-2 font-semibold text-red-700">— LIMIT EXCEEDED</span>
          )}
        </div>
      )}

      <div className="rounded-md border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-slate-950">Transaction history</div>
          <div className="flex flex-wrap gap-2">
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm" />
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm" />
          </div>
        </div>
        {entries.length === 0 ? (
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
                {entries.map((entry) => {
                  const amount = toMoneyNumber(entry.amount);
                  const balance = toMoneyNumber(entry.balance);
                  return (
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
                      {entry.type === "payment" ? "−" : "+"}{money(amount)}
                    </td>
                    <td className={`px-4 py-2 text-right text-xs font-semibold ${balance > 0 ? "text-red-600" : "text-slate-500"}`}>
                      {money(balance)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <PaginationControls page={page} limit={pageSize} total={data.total ?? entries.length} onPageChange={setPage} />
      </div>
    </div>
  );
}

function toMoneyNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
