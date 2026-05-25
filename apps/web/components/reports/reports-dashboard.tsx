"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { StatStrip } from "@/components/shared/stat-strip";
import { createAuthenticatedApiClient } from "@/lib/api-client";
import { getStoredTenant } from "@/lib/vertical-config";

type Tab = "sales" | "inventory" | "pnl" | "gstr" | "dayend";

interface ReportSummary {
  grossSales: number;
  netSales: number;
  discountTotal: number;
  totalGst: number;
  totalCgst: number;
  totalSgst: number;
  invoiceCount: number;
  averageBillValue: number;
  paid: number;
  due: number;
  dailySales: Array<{ date: string; sales: number; invoices: number }>;
  gstByRate: Array<{ gstRate: number; taxableValue: number; cgst: number; sgst: number; totalGst: number }>;
  hsnSummary: Array<{ hsnCode: string; taxableValue: number; totalGst: number; totalSales: number }>;
  movingItems: Array<{ productName: string; quantitySold: number; totalSales: number }>;
}

interface InventoryReport {
  stockValue: number;
  lowStockCount: number;
  stockByCategory: Array<{ category: string; stock: number }>;
}

interface PnlReport {
  revenue: number;
  cost: number;
  grossProfit: number;
  grossMarginPct: number;
  items: Array<{ productName: string; quantitySold: number; revenue: number; cost: number; profit: number; marginPct: number }>;
}

interface DayEndReport {
  date: string;
  openingCash: number;
  salesCash: number;
  salesUpi: number;
  salesCard: number;
  salesCredit: number;
  totalCollection: number;
  invoiceCount: number;
  refunds: number;
  closingCash: number;
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function weekAgoStr() { return new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10); }

export function ReportsDashboard() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab | null) ?? "sales";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [from, setFrom] = useState(weekAgoStr());
  const [to, setTo] = useState(todayStr());
  const [gstEnabled, setGstEnabled] = useState(true);

  useEffect(() => {
    const enabled = getStoredTenant()?.gstEnabled !== false;
    setGstEnabled(enabled);
    if (!enabled && tab === "gstr") {
      setTab("sales");
    }
  }, [tab]);

  const summaryQuery = useQuery({
    queryKey: ["reports-summary", from, to],
    queryFn: () =>
      createAuthenticatedApiClient().get<ReportSummary>(`/reports/summary?from=${from}&to=${to}`),
    enabled: tab === "sales" || (gstEnabled && tab === "gstr"),
  });
  const inventoryQuery = useQuery({
    queryKey: ["reports-inventory"],
    queryFn: () => createAuthenticatedApiClient().get<InventoryReport>("/reports/inventory"),
    enabled: tab === "inventory",
  });
  const pnlQuery = useQuery({
    queryKey: ["reports-pnl", from, to],
    queryFn: () => createAuthenticatedApiClient().get<PnlReport>(`/reports/pnl?from=${from}&to=${to}`),
    enabled: tab === "pnl",
  });
  const dayEndQuery = useQuery({
    queryKey: ["reports-dayend", to],
    queryFn: () => createAuthenticatedApiClient().get<DayEndReport>(`/reports/day-end?date=${to}`),
    enabled: tab === "dayend",
  });

  const summary = summaryQuery.data;
  const inventory = inventoryQuery.data;
  const pnl = pnlQuery.data;
  const dayEnd = dayEndQuery.data;

  const salesData = summary?.dailySales.map((item) => ({
    day: item.date.slice(5),
    sales: item.sales,
    invoices: item.invoices,
  })) ?? [];
  const stockData = inventory?.stockByCategory.map((item) => ({ category: item.category, value: item.stock })) ?? [];

  const tabs: { id: Tab; label: string }[] = [
    { id: "sales", label: "Sales" },
    { id: "inventory", label: "Inventory" },
    { id: "pnl", label: "P&L" },
    ...(gstEnabled ? [{ id: "gstr" as const, label: "GSTR Export" }] : []),
    { id: "dayend", label: "Day-End" },
  ];

  function downloadCsv(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function exportGstr1() {
    if (!summary) return;
    const rows = [
      ["HSN Code", "Taxable Value", "CGST", "SGST", "Total GST", "Total Sales"],
      ...summary.hsnSummary.map((h) => [h.hsnCode, h.taxableValue, "", "", h.totalGst, h.totalSales]),
    ];
    downloadCsv(rows.map((r) => r.join(",")).join("\n"), `GSTR1_${from}_${to}.csv`);
  }

  function exportGstr3b() {
    if (!summary) return;
    const rows = [
      ["GST Rate %", "Taxable Value", "CGST", "SGST", "Total GST"],
      ...summary.gstByRate.map((g) => [g.gstRate, g.taxableValue, g.cgst, g.sgst, g.totalGst]),
    ];
    downloadCsv(rows.map((r) => r.join(",")).join("\n"), `GSTR3B_${from}_${to}.csv`);
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t.id ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500 hover:text-slate-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Date range picker (shown for sales/pnl/gstr/dayend) */}
      {tab !== "inventory" && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-border px-3 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-md border border-border px-3 text-sm" />
          </label>
          {[
            { label: "Today", fn: () => { setFrom(todayStr()); setTo(todayStr()); } },
            { label: "Last 7d", fn: () => { setFrom(weekAgoStr()); setTo(todayStr()); } },
            { label: "This month", fn: () => { const d = new Date(); setFrom(`${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-01`); setTo(todayStr()); } },
          ].map((q) => (
            <button key={q.label} onClick={q.fn} className="h-9 rounded-md border border-border px-3 text-sm text-slate-600 hover:bg-slate-50">{q.label}</button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/reports/payment-methods" className="h-9 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Payment statements</Link>
        <Link href="/reports/settlements" className="h-9 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Settlements</Link>
        {tab === "sales" ? (
          <>
            <ExportButton label="Summary CSV" onClick={() => void downloadReportExport("summary", `summary-${from}-${to}`, "csv")} />
            <ExportButton label="Daily Excel" onClick={() => void downloadReportExport("daily-sales", `daily-sales-${from}-${to}`, "xlsx")} />
            <ExportButton label="Moving items CSV" onClick={() => void downloadReportExport("moving-items", `moving-items-${from}-${to}`, "csv")} />
          </>
        ) : null}
        {tab === "inventory" ? (
          <>
            <ExportButton label="Inventory CSV" onClick={() => void downloadReportExport("inventory", "inventory", "csv")} />
            <ExportButton label="Inventory Excel" onClick={() => void downloadReportExport("inventory", "inventory", "xlsx")} />
          </>
        ) : null}
        {tab === "pnl" && canViewPnl ? (
          <>
            <ExportButton label="P&L CSV" onClick={() => void downloadReportExport("pnl", `pnl-${from}-${to}`, "csv")} />
            <ExportButton label="P&L Excel" onClick={() => void downloadReportExport("pnl", `pnl-${from}-${to}`, "xlsx")} />
          </>
        ) : null}
        {tab === "gstr" ? (
          <>
            <ExportButton label="GST CSV" onClick={() => void downloadReportExport("gst", `gst-${from}-${to}`, "csv")} />
            <ExportButton label="GST Excel" onClick={() => void downloadReportExport("gst", `gst-${from}-${to}`, "xlsx")} />
          </>
        ) : null}
        {tab === "customers" ? (
          <>
            <ExportButton label="Customer sales CSV" onClick={() => void downloadAdvancedReportExport("customer-sales", `customer-sales-${from}-${to}`, "csv")} />
            <ExportButton label="Customer sales Excel" onClick={() => void downloadAdvancedReportExport("customer-sales", `customer-sales-${from}-${to}`, "xlsx")} />
          </>
        ) : null}
        {tab === "suppliers" ? (
          <>
            <ExportButton label="Supplier purchases CSV" onClick={() => void downloadAdvancedReportExport("supplier-purchases", `supplier-purchases-${from}-${to}`, "csv")} />
            <ExportButton label="Supplier purchases Excel" onClick={() => void downloadAdvancedReportExport("supplier-purchases", `supplier-purchases-${from}-${to}`, "xlsx")} />
          </>
        ) : null}
        {tab === "aging" ? (
          <>
            <ExportButton label="Aging CSV" onClick={() => void downloadAdvancedReportExport("outstanding-aging", "outstanding-aging", "csv")} />
            <ExportButton label="Aging Excel" onClick={() => void downloadAdvancedReportExport("outstanding-aging", "outstanding-aging", "xlsx")} />
          </>
        ) : null}
        {tab === "stock" ? (
          <ExportButton label="Stock movement CSV" onClick={() => void downloadStockMovementExport("csv")} />
        ) : null}
        {tab === "tally" ? (
          <ExportButton label="Download Tally XML" onClick={() => void downloadTallyExport()} />
        ) : null}
      </div>

      {/* --- SALES TAB --- */}
      {tab === "sales" && (
        <>
          <StatStrip items={[
            { label: "Gross sales", value: money(summary?.grossSales ?? 0), tone: "emerald" },
            ...(gstEnabled ? [{ label: "GST collected", value: money(summary?.totalGst ?? 0), tone: "blue" as const }] : []),
            { label: "Invoices", value: String(summary?.invoiceCount ?? 0), tone: "slate" },
            { label: "Avg bill", value: money(summary?.averageBillValue ?? 0), tone: "amber" },
            { label: "Collected", value: money(summary?.paid ?? 0), tone: "emerald" },
            { label: "Outstanding", value: money(summary?.due ?? 0), tone: "amber" },
          ]} />
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Daily sales">
              <LineChart data={salesData}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => money(Number(v))} />
                <Line type="monotone" dataKey="sales" stroke="#059669" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="invoices" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartCard>
            <ChartCard title="Stock by category">
              <BarChart data={stockData}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="category" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
            <div className="rounded-md border border-border bg-white p-4 xl:col-span-2">
              <div className="grid gap-4 md:grid-cols-3">
                <ReportList title="Fast-moving items" items={(summary?.movingItems ?? []).slice(0, 8).map((i) => `${i.productName} — ${String(i.quantitySold)} units`)} />
                {gstEnabled ? (
                  <>
                    <ReportList title="GST by rate" items={(summary?.gstByRate ?? []).map((i) => `${String(i.gstRate)}% -> ${money(i.totalGst)}`)} />
                    <ReportList title="HSN summary" items={(summary?.hsnSummary ?? []).slice(0, 8).map((i) => `${i.hsnCode} - ${money(i.totalSales)}`)} />
                  </>
                ) : (
                  <ReportList title="Non-GST sales" items={["GST reports are hidden because GST is disabled for this shop."]} />
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* --- INVENTORY TAB --- */}
      {tab === "inventory" && (
        <>
          <StatStrip items={[
            { label: "Stock value", value: money(inventory?.stockValue ?? 0), tone: "blue" },
            { label: "Low stock items", value: String(inventory?.lowStockCount ?? 0), tone: "amber" },
          ]} />
          <ChartCard title="Stock by category">
            <BarChart data={stockData}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="category" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
        </>
      )}

      {/* --- P&L TAB --- */}
      {tab === "pnl" && (
        <>
          <StatStrip items={[
            { label: "Revenue", value: money(pnl?.revenue ?? 0), tone: "emerald" },
            { label: "COGS", value: money(pnl?.cost ?? 0), tone: "amber" },
            { label: "Gross Profit", value: money(pnl?.grossProfit ?? 0), tone: "blue" },
            { label: "Margin", value: `${(pnl?.grossMarginPct ?? 0).toFixed(1)}%`, tone: "slate" },
          ]} />
          <div className="rounded-md border border-border bg-white">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Product-level P&L</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Product</th>
                    <th className="px-4 py-2 text-right font-medium">Qty sold</th>
                    <th className="px-4 py-2 text-right font-medium">Revenue</th>
                    <th className="px-4 py-2 text-right font-medium">COGS</th>
                    <th className="px-4 py-2 text-right font-medium">Profit</th>
                    <th className="px-4 py-2 text-right font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(pnl?.items ?? []).map((item) => (
                    <tr key={item.productName}>
                      <td className="px-4 py-2 font-medium">{item.productName}</td>
                      <td className="px-4 py-2 text-right">{item.quantitySold}</td>
                      <td className="px-4 py-2 text-right">{money(item.revenue)}</td>
                      <td className="px-4 py-2 text-right text-amber-700">{money(item.cost)}</td>
                      <td className="px-4 py-2 text-right text-emerald-700">{money(item.profit)}</td>
                      <td className="px-4 py-2 text-right">{item.marginPct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* --- GSTR TAB --- */}
      {tab === "gstr" && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <button onClick={exportGstr1} disabled={!summary} className="h-10 rounded-md bg-emerald-600 px-5 text-sm font-medium text-white disabled:opacity-40">
              Export GSTR-1 (CSV)
            </button>
            <button onClick={exportGstr3b} disabled={!summary} className="h-10 rounded-md border border-border px-5 text-sm font-medium text-slate-700 disabled:opacity-40">
              Export GSTR-3B (CSV)
            </button>
          </div>
          {summary && (
            <div className="rounded-md border border-border bg-white">
              <div className="border-b border-border px-4 py-3 text-sm font-semibold">GSTR-1 — HSN-wise summary ({from} to {to})</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">HSN Code</th>
                      <th className="px-4 py-2 text-right font-medium">Taxable Value</th>
                      <th className="px-4 py-2 text-right font-medium">CGST</th>
                      <th className="px-4 py-2 text-right font-medium">SGST</th>
                      <th className="px-4 py-2 text-right font-medium">Total GST</th>
                      <th className="px-4 py-2 text-right font-medium">Total Sales</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {summary.hsnSummary.map((h) => (
                      <tr key={h.hsnCode}>
                        <td className="px-4 py-2 font-mono">{h.hsnCode}</td>
                        <td className="px-4 py-2 text-right">{money(h.taxableValue)}</td>
                        <td className="px-4 py-2 text-right">{money(summary.totalCgst)}</td>
                        <td className="px-4 py-2 text-right">{money(summary.totalSgst)}</td>
                        <td className="px-4 py-2 text-right">{money(h.totalGst)}</td>
                        <td className="px-4 py-2 text-right font-medium">{money(h.totalSales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border px-4 py-3 text-sm font-semibold">GSTR-3B — GST rate-wise summary</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">GST Rate</th>
                      <th className="px-4 py-2 text-right font-medium">Taxable Value</th>
                      <th className="px-4 py-2 text-right font-medium">CGST</th>
                      <th className="px-4 py-2 text-right font-medium">SGST</th>
                      <th className="px-4 py-2 text-right font-medium">Total GST</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {summary.gstByRate.map((g) => (
                      <tr key={g.gstRate}>
                        <td className="px-4 py-2">{g.gstRate}%</td>
                        <td className="px-4 py-2 text-right">{money(g.taxableValue)}</td>
                        <td className="px-4 py-2 text-right">{money(g.cgst)}</td>
                        <td className="px-4 py-2 text-right">{money(g.sgst)}</td>
                        <td className="px-4 py-2 text-right font-medium">{money(g.totalGst)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- DAY-END TAB --- */}
      {tab === "dayend" && (
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-950">Day-end closing — {to}</h2>
            {dayEnd ? (
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {[
                  { label: "Cash sales", value: money(dayEnd.salesCash) },
                  { label: "UPI sales", value: money(dayEnd.salesUpi) },
                  { label: "Card sales", value: money(dayEnd.salesCard) },
                  { label: "Credit sales", value: money(dayEnd.salesCredit) },
                  { label: "Total collection", value: money(dayEnd.totalCollection) },
                  { label: "Invoices raised", value: String(dayEnd.invoiceCount) },
                  { label: "Refunds", value: money(dayEnd.refunds) },
                  { label: "Closing cash", value: money(dayEnd.closingCash) },
                ].map((row) => (
                  <div key={row.label} className="rounded-md border border-border p-3">
                    <div className="text-xs text-slate-500">{row.label}</div>
                    <div className="mt-1 text-lg font-bold text-slate-950">{row.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No data for selected date.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="rounded-md border border-border bg-white p-4">
      <div className="mb-4 text-sm font-semibold text-slate-950">{title}</div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </section>
  );
}

function ReportList({ title, items }: Readonly<{ title: string; items: string[] }>) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-950">{title}</div>
      <div className="space-y-1">
        {items.length > 0
          ? items.map((item) => <div key={item} className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{item}</div>)
          : <div className="text-sm text-slate-400">No data yet</div>}
      </div>
    </div>
  );
}

function money(v: number) {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
