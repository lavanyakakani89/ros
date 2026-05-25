"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";

interface PaymentMethodRecord {
  id: string;
  name: string;
  short_code: string;
  type: string;
  color: string;
}

interface StatementTransaction {
  date: string;
  time: string;
  invoice_number: string;
  customer_name: string;
  cashier_name: string;
  amount: number;
  reference_number: string | null;
  type: "sale" | "refund" | "void";
  void_reason?: string | null;
  running_balance: number;
}

interface StatementResponse {
  method: PaymentMethodRecord;
  period: { from: string; to: string };
  summary: {
    opening_balance: number;
    total_sales: number;
    total_refunds: number;
    net_amount: number;
    transaction_count: number;
    void_count: number;
  };
  transactions: StatementTransaction[];
  pagination: { total: number; page: number; per_page: number; total_pages: number };
}

export function PaymentMethodsReport() {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [search, setSearch] = useState("");
  const api = createAuthenticatedApiClient();

  const methodsQuery = useQuery({
    queryKey: ["payment-methods", "reports"],
    queryFn: () => api.get<PaymentMethodRecord[]>("/payment-methods"),
  });
  const methods = methodsQuery.data ?? [];
  const activeMethodId = selectedMethodId ?? methods[0]?.id ?? null;

  const statementQuery = useQuery({
    queryKey: ["payment-method-statement", activeMethodId, dateFrom, dateTo],
    enabled: Boolean(activeMethodId),
    queryFn: () => api.get<StatementResponse>(`/reports/payment-method-statement?payment_method_id=${encodeURIComponent(activeMethodId ?? "")}&date_from=${dateFrom}&date_to=${dateTo}`),
  });

  const statement = statementQuery.data;
  const filteredTransactions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = statement?.transactions ?? [];
    if (!needle) return rows;
    return rows.filter((row) => [row.invoice_number, row.customer_name, row.cashier_name, row.reference_number ?? ""].some((value) => value.toLowerCase().includes(needle)));
  }, [search, statement?.transactions]);

  function setPreset(preset: "today" | "week" | "month") {
    const now = new Date();
    const from = new Date(now);
    if (preset === "week") from.setDate(now.getDate() - 6);
    if (preset === "month") from.setDate(1);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(now.toISOString().slice(0, 10));
  }

  function exportCsv() {
    if (!statement) return;
    const rows = [
      ["Date", "Time", "Invoice", "Customer", "Cashier", "Type", "Reference", "Amount", "Balance"],
      ...filteredTransactions.map((row) => [row.date, row.time, row.invoice_number, row.customer_name, row.cashier_name, row.type, row.reference_number ?? "", String(row.amount), String(row.running_balance)]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${statement.method.short_code}-${dateFrom}-${dateTo}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="rounded-md border border-border bg-white p-3">
        <div className="mb-3 text-sm font-semibold text-slate-900">Payment methods</div>
        <div className="grid gap-1">
          {methods.map((method) => (
            <button key={method.id} className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${activeMethodId === method.id ? "bg-slate-100 font-semibold text-slate-950" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => setSelectedMethodId(method.id)}>
              <span className="size-2.5 rounded-full" style={{ backgroundColor: method.color }} />
              <span>{method.name}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="space-y-4">
        <div className="rounded-md border border-border bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex gap-2">
              <button className="h-9 rounded-md border border-border px-3 text-sm font-medium" onClick={() => setPreset("today")}>Today</button>
              <button className="h-9 rounded-md border border-border px-3 text-sm font-medium" onClick={() => setPreset("week")}>This week</button>
              <button className="h-9 rounded-md border border-border px-3 text-sm font-medium" onClick={() => setPreset("month")}>This month</button>
            </div>
            <label className="text-sm font-medium text-slate-700">From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 block h-9 rounded-md border border-border px-3" /></label>
            <label className="text-sm font-medium text-slate-700">To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 block h-9 rounded-md border border-border px-3" /></label>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions" className="h-9 min-w-56 rounded-md border border-border px-3 text-sm" />
            <button className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold" onClick={exportCsv} disabled={!statement}>
              <Download className="size-4" /> Export CSV
            </button>
          </div>
        </div>

        {statement ? (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label="Total sales" value={statement.summary.total_sales} tone="green" />
              <Metric label="Total refunds" value={statement.summary.total_refunds} tone="red" />
              <Metric label="Net amount" value={statement.summary.net_amount} tone="blue" />
              <Metric label="Transactions" value={statement.summary.transaction_count} format="count" />
            </div>

            <div className="overflow-hidden rounded-md border border-border bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Date & time</th>
                    <th className="px-3 py-2">Invoice #</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Cashier</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Reference</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((row) => (
                    <tr key={`${row.invoice_number}-${row.time}-${row.amount}`} className={`border-t border-border ${row.type === "void" ? "text-slate-400 line-through" : "text-slate-700"}`}>
                      <td className="px-3 py-2">{row.date} {row.time}</td>
                      <td className="px-3 py-2 font-medium">{row.invoice_number}</td>
                      <td className="px-3 py-2">{row.customer_name}</td>
                      <td className="px-3 py-2">{row.cashier_name || "-"}</td>
                      <td className="px-3 py-2"><span className={row.type === "sale" ? "text-emerald-700" : row.type === "refund" ? "text-red-700" : "text-slate-500"}>{row.type}</span></td>
                      <td className="px-3 py-2">{row.reference_number || "-"}</td>
                      <td className="px-3 py-2 text-right">{money(row.amount)}</td>
                      <td className="px-3 py-2 text-right">{money(row.running_balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-md border border-border bg-white p-4 text-sm text-slate-700">
              Opening balance {money(statement.summary.opening_balance)} | Closing balance {money((filteredTransactions.at(-1)?.running_balance ?? statement.summary.opening_balance))} | Net movement {money(statement.summary.net_amount)}
            </div>
          </>
        ) : (
          <div className="rounded-md border border-border bg-white p-6 text-sm text-slate-500">{statementQuery.isLoading ? "Loading statement..." : "Select a payment method to view its statement."}</div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, tone = "neutral", format = "money" }: Readonly<{ label: string; value: number; tone?: "green" | "red" | "blue" | "neutral"; format?: "money" | "count" }>) {
  const toneClass = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : tone === "blue" ? "text-sky-700" : "text-slate-700";
  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${toneClass}`}>{format === "money" ? money(value) : value}</div>
    </div>
  );
}

function money(value: number) {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}
