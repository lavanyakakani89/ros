"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { StatStrip } from "@/components/shared/stat-strip";
import { createAuthenticatedApiClient, downloadApiFile, listProducts } from "@/lib/api-client";
import { getStoredAuthSession, getStoredTenant } from "@/lib/vertical-config";

type Tab = "sales" | "inventory" | "pnl" | "gstr" | "dayend" | "customers" | "suppliers" | "aging" | "stock" | "comparison" | "tally";

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

interface PaginatedReport<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

interface CustomerSalesReportRow {
  id: string;
  name: string;
  phone: string;
  invoiceCount: number;
  totalRevenue: number;
  totalPaid: number;
  outstanding: number;
  lastPurchaseDate: string | null;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    status: string;
    grandTotal: number;
    amountPaid: number;
    amountDue: number;
  }>;
}

interface SupplierPurchasesReportRow {
  id: string;
  name: string;
  phone: string;
  poCount: number;
  totalPurchased: number;
  totalPaid: number;
  outstanding: number;
}

interface AgingReport {
  buckets: Array<{ bucket: string; customerCount: number; totalOutstanding: number }>;
  customers: Array<{ id: string; name: string; phone: string; totalOutstanding: number; invoiceCount: number; oldestInvoiceDate: string; bucket: string }>;
}

interface StockMovementReportRow {
  productId: string;
  productName: string;
  date: string;
  type: string;
  qty: number;
  reference: string;
  notes: string;
  runningBalance: number;
}

interface ComparisonReport {
  metric: "revenue" | "invoices" | "customers" | "expenses";
  period: "monthly" | "weekly";
  year1: number;
  year2: number;
  rows: Array<{
    period: string;
    year1Value: number;
    year2Value: number;
    changePct: number | null;
  }>;
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function weekAgoStr() { return new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10); }

export function ReportsDashboard() {
  const searchParams = useSearchParams();
  // Next widens this to nullable during production builds when pages/ exists.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const initialTab = (searchParams?.get("tab") as Tab | null) ?? "sales";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [from, setFrom] = useState(weekAgoStr());
  const [to, setTo] = useState(todayStr());
  const [gstEnabled, setGstEnabled] = useState(true);
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
  const [stockProductSearch, setStockProductSearch] = useState("");
  const [stockProductId, setStockProductId] = useState("");
  const [stockMovementType, setStockMovementType] = useState("");
  const currentYear = new Date().getFullYear();
  const [comparisonMetric, setComparisonMetric] = useState<ComparisonReport["metric"]>("revenue");
  const [comparisonPeriod, setComparisonPeriod] = useState<ComparisonReport["period"]>("monthly");
  const [comparisonYear1, setComparisonYear1] = useState(currentYear - 1);
  const [comparisonYear2, setComparisonYear2] = useState(currentYear);
  const canViewPnl = getStoredAuthSession()?.user?.role === "OWNER";

  useEffect(() => {
    const enabled = getStoredTenant()?.gstEnabled !== false;
    setGstEnabled(enabled);
    if ((!enabled && tab === "gstr") || (!canViewPnl && tab === "pnl")) {
      setTab("sales");
    }
  }, [canViewPnl, tab]);

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
    enabled: canViewPnl && tab === "pnl",
  });
  const dayEndQuery = useQuery({
    queryKey: ["reports-dayend", to],
    queryFn: () => createAuthenticatedApiClient().get<DayEndReport>(`/reports/day-end?date=${to}`),
    enabled: tab === "dayend",
  });
  const customerSalesQuery = useQuery({
    queryKey: ["reports-customer-sales", from, to],
    queryFn: () => createAuthenticatedApiClient().get<PaginatedReport<CustomerSalesReportRow>>(`/reports/customer-sales?from=${from}&to=${to}&limit=50&sortBy=revenue`),
    enabled: tab === "customers",
  });
  const supplierPurchasesQuery = useQuery({
    queryKey: ["reports-supplier-purchases", from, to],
    queryFn: () => createAuthenticatedApiClient().get<PaginatedReport<SupplierPurchasesReportRow>>(`/reports/supplier-purchases?from=${from}&to=${to}&limit=50`),
    enabled: tab === "suppliers",
  });
  const agingQuery = useQuery({
    queryKey: ["reports-aging"],
    queryFn: () => createAuthenticatedApiClient().get<AgingReport>("/reports/outstanding-aging"),
    enabled: tab === "aging",
  });
  const stockMovementQuery = useQuery({
    queryKey: ["reports-stock-movement", from, to, stockProductId, stockMovementType],
    queryFn: () => createAuthenticatedApiClient().get<PaginatedReport<StockMovementReportRow>>(`/reports/stock-movement?${stockMovementQueryString(from, to, stockProductId, stockMovementType)}`),
    enabled: tab === "stock",
  });
  const stockProductSearchQuery = useQuery({
    queryKey: ["reports-stock-product-search", stockProductSearch],
    queryFn: () => listProducts({ search: stockProductSearch.trim(), limit: 20 }),
    enabled: tab === "stock" && stockProductSearch.trim().length > 0,
  });
  const comparisonQuery = useQuery({
    queryKey: ["reports-comparison", comparisonMetric, comparisonPeriod, comparisonYear1, comparisonYear2],
    queryFn: () => createAuthenticatedApiClient().get<ComparisonReport>(`/reports/comparison?metric=${comparisonMetric}&period=${comparisonPeriod}&year1=${String(comparisonYear1)}&year2=${String(comparisonYear2)}`),
    enabled: tab === "comparison" && comparisonYear1 !== comparisonYear2,
  });

  const summary = summaryQuery.data;
  const inventory = inventoryQuery.data;
  const pnl = pnlQuery.data;
  const dayEnd = dayEndQuery.data;
  const customerSales = customerSalesQuery.data;
  const supplierPurchases = supplierPurchasesQuery.data;
  const aging = agingQuery.data;
  const stockMovement = stockMovementQuery.data;
  const stockProductResults = stockProductSearchQuery.data?.data ?? [];
  const comparison = comparisonQuery.data;

  const salesData = summary?.dailySales.map((item) => ({
    day: item.date.slice(5),
    sales: item.sales,
    invoices: item.invoices,
  })) ?? [];
  const stockData = inventory?.stockByCategory.map((item) => ({ category: item.category, value: item.stock })) ?? [];

  const tabs: { id: Tab; label: string }[] = [
    { id: "sales", label: "Sales" },
    { id: "inventory", label: "Inventory" },
    ...(canViewPnl ? [{ id: "pnl" as const, label: "P&L" }] : []),
    ...(gstEnabled ? [{ id: "gstr" as const, label: "GSTR Export" }] : []),
    { id: "dayend", label: "Day-End" },
    { id: "customers", label: "Customers" },
    { id: "suppliers", label: "Suppliers" },
    { id: "aging", label: "Aging" },
    { id: "stock", label: "Stock Movement" },
    { id: "comparison", label: "YoY / MoM" },
    { id: "tally", label: "Tally Export" },
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

  async function downloadReportExport(endpoint: string, filename: string, format: "csv" | "xlsx") {
    const query = new URLSearchParams({ format });
    if (tab !== "inventory") {
      query.set("from", from);
      query.set("to", to);
    }
    await downloadApiFile(`/reports/${endpoint}/export?${query.toString()}`, `${filename}.${format}`);
  }

  async function downloadAdvancedReportExport(endpoint: string, filename: string, format: "csv" | "xlsx") {
    const query = new URLSearchParams({ format, from, to });
    await downloadApiFile(`/reports/${endpoint}/export?${query.toString()}`, `${filename}.${format}`);
  }

  async function downloadStockMovementExport(format: "csv" | "xlsx") {
    await downloadApiFile(`/reports/stock-movement/export?${stockMovementQueryString(from, to, stockProductId, stockMovementType, format)}`, `stock-movement-${from}-${to}.${format}`);
  }

  async function downloadTallyExport() {
    await downloadApiFile(`/reports/tally-export?from=${from}&to=${to}`, `tally-export-${from}-${to}.xml`);
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
      {tab !== "inventory" && tab !== "aging" && tab !== "comparison" && (
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
      {canViewPnl && tab === "pnl" && (
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

      {tab === "customers" && (
        <TableShell title="Customer sales" loading={customerSalesQuery.isLoading} empty={(customerSales?.data ?? []).length === 0}>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Customer</th>
                <th className="px-4 py-2 text-right font-medium">Invoices</th>
                <th className="px-4 py-2 text-right font-medium">Revenue</th>
                <th className="px-4 py-2 text-right font-medium">Paid</th>
                <th className="px-4 py-2 text-right font-medium">Outstanding</th>
                <th className="px-4 py-2 text-right font-medium">Last purchase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(customerSales?.data ?? []).map((row) => (
                <Fragment key={row.id}>
                  <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setExpandedCustomerId((current) => current === row.id ? null : row.id)}>
                    <td className="px-4 py-2"><span className="font-medium">{row.name}</span><span className="block text-xs text-slate-400">{row.phone}</span></td>
                    <td className="px-4 py-2 text-right">{row.invoiceCount}</td>
                    <td className="px-4 py-2 text-right">{money(row.totalRevenue)}</td>
                    <td className="px-4 py-2 text-right">{money(row.totalPaid)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-amber-700">{money(row.outstanding)}</td>
                    <td className="px-4 py-2 text-right">{row.lastPurchaseDate ? new Date(row.lastPurchaseDate).toLocaleDateString("en-IN") : "-"}</td>
                  </tr>
                  {expandedCustomerId === row.id ? (
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="overflow-x-auto rounded-md border border-border bg-white">
                          <table className="w-full min-w-[620px] text-xs">
                            <thead className="bg-slate-50 text-slate-500">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium">Invoice</th>
                                <th className="px-3 py-2 text-left font-medium">Date</th>
                                <th className="px-3 py-2 text-left font-medium">Status</th>
                                <th className="px-3 py-2 text-right font-medium">Total</th>
                                <th className="px-3 py-2 text-right font-medium">Paid</th>
                                <th className="px-3 py-2 text-right font-medium">Due</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {row.invoices.map((invoice) => (
                                <tr key={invoice.id}>
                                  <td className="px-3 py-2 font-mono">{invoice.invoiceNumber}</td>
                                  <td className="px-3 py-2">{new Date(invoice.invoiceDate).toLocaleDateString("en-IN")}</td>
                                  <td className="px-3 py-2">{invoice.status}</td>
                                  <td className="px-3 py-2 text-right">{money(invoice.grandTotal)}</td>
                                  <td className="px-3 py-2 text-right">{money(invoice.amountPaid)}</td>
                                  <td className="px-3 py-2 text-right font-semibold text-amber-700">{money(invoice.amountDue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}

      {tab === "suppliers" && (
        <TableShell title="Supplier purchases" loading={supplierPurchasesQuery.isLoading} empty={(supplierPurchases?.data ?? []).length === 0}>
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Supplier</th>
                <th className="px-4 py-2 text-right font-medium">POs</th>
                <th className="px-4 py-2 text-right font-medium">Purchased</th>
                <th className="px-4 py-2 text-right font-medium">Paid</th>
                <th className="px-4 py-2 text-right font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(supplierPurchases?.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2"><span className="font-medium">{row.name}</span><span className="block text-xs text-slate-400">{row.phone}</span></td>
                  <td className="px-4 py-2 text-right">{row.poCount}</td>
                  <td className="px-4 py-2 text-right">{money(row.totalPurchased)}</td>
                  <td className="px-4 py-2 text-right">{money(row.totalPaid)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-amber-700">{money(row.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}

      {tab === "aging" && (
        <div className="space-y-4">
          <section className="rounded-md border border-border bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-slate-950">Outstanding breakdown</div>
            <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
              {(aging?.buckets ?? []).map((bucket, index) => (
                <div
                  key={bucket.bucket}
                  className={agingBucketBarClass(index)}
                  style={{ width: `${String(agingBucketWidth(bucket.totalOutstanding, aging?.buckets ?? []))}%` }}
                  title={`${bucket.bucket} days: ${money(bucket.totalOutstanding)}`}
                />
              ))}
            </div>
            <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
              {(aging?.buckets ?? []).map((bucket, index) => (
                <div key={bucket.bucket} className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${agingBucketDotClass(index)}`} />
                  <span>{bucket.bucket} days · {money(bucket.totalOutstanding)}</span>
                </div>
              ))}
            </div>
          </section>
          <div className="grid gap-3 md:grid-cols-4">
            {(aging?.buckets ?? []).map((bucket) => (
              <div key={bucket.bucket} className="rounded-md border border-border bg-white p-4">
                <div className="text-xs text-slate-500">{bucket.bucket} days</div>
                <div className="mt-1 text-xl font-bold text-slate-950">{money(bucket.totalOutstanding)}</div>
                <div className="text-xs text-slate-400">{bucket.customerCount} customers</div>
              </div>
            ))}
          </div>
          <TableShell title="Outstanding aging" loading={agingQuery.isLoading} empty={(aging?.customers ?? []).length === 0}>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Customer</th>
                  <th className="px-4 py-2 text-right font-medium">Outstanding</th>
                  <th className="px-4 py-2 text-right font-medium">Invoices</th>
                  <th className="px-4 py-2 text-right font-medium">Oldest unpaid</th>
                  <th className="px-4 py-2 text-right font-medium">Bucket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(aging?.customers ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2"><span className="font-medium">{row.name}</span><span className="block text-xs text-slate-400">{row.phone}</span></td>
                    <td className="px-4 py-2 text-right font-semibold text-amber-700">{money(row.totalOutstanding)}</td>
                    <td className="px-4 py-2 text-right">{row.invoiceCount}</td>
                    <td className="px-4 py-2 text-right">{new Date(row.oldestInvoiceDate).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-2 text-right">{row.bucket}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>
      )}

      {tab === "stock" && (
        <div className="space-y-4">
          <section className="rounded-md border border-border bg-white p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
              <div className="relative">
                <label className="text-xs font-medium text-slate-500">Product filter</label>
                <input
                  value={stockProductSearch}
                  onChange={(event) => {
                    setStockProductSearch(event.target.value);
                    if (!event.target.value.trim()) {
                      setStockProductId("");
                    }
                  }}
                  placeholder="Search product name, SKU, or barcode"
                  className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600"
                />
                {stockProductSearch.trim() && stockProductResults.length > 0 ? (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-white shadow-lg">
                    {stockProductResults.map((product) => (
                      <button key={product.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-emerald-50" onClick={() => {
                        setStockProductId(product.id);
                        setStockProductSearch(product.name);
                      }}>
                        <span className="font-medium text-slate-900">{product.name}</span>
                        <span className="ml-2 text-xs text-slate-400">{product.barcode ?? product.sku ?? ""}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <label className="text-xs font-medium text-slate-500">
                Movement type
                <select value={stockMovementType} onChange={(event) => setStockMovementType(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm">
                  <option value="">All types</option>
                  <option value="sale">Sale</option>
                  <option value="purchase">Purchase</option>
                  <option value="return">Return</option>
                  <option value="adjustment">Adjustment</option>
                </select>
              </label>
              <button type="button" className="h-10 self-end rounded-md border border-border px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => {
                setStockProductSearch("");
                setStockProductId("");
                setStockMovementType("");
              }}>
                Clear filters
              </button>
            </div>
          </section>
          <TableShell title="Stock movement" loading={stockMovementQuery.isLoading} empty={(stockMovement?.data ?? []).length === 0}>
            <table className="w-full min-w-[840px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Product</th>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Change</th>
                  <th className="px-4 py-2 text-right font-medium">Balance</th>
                  <th className="px-4 py-2 text-left font-medium">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(stockMovement?.data ?? []).map((row, index) => (
                  <tr key={`${row.productId}-${row.date}-${row.reference}-${String(index)}`}>
                    <td className="px-4 py-2">{new Date(row.date).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2 font-medium">{row.productName}</td>
                    <td className="px-4 py-2 capitalize">{row.type}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${row.qty >= 0 ? "text-emerald-700" : "text-red-700"}`}>{row.qty}</td>
                    <td className="px-4 py-2 text-right">{row.runningBalance}</td>
                    <td className="px-4 py-2">{row.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>
      )}

      {tab === "comparison" && (
        <div className="space-y-4">
          <section className="rounded-md border border-border bg-white p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs font-medium text-slate-500">
                Metric
                <select value={comparisonMetric} onChange={(event) => setComparisonMetric(event.target.value as ComparisonReport["metric"])} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm">
                  <option value="revenue">Revenue</option>
                  <option value="invoices">Invoices</option>
                  <option value="customers">New customers</option>
                  <option value="expenses">Expenses</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-500">
                Period
                <select value={comparisonPeriod} onChange={(event) => setComparisonPeriod(event.target.value as ComparisonReport["period"])} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm">
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-500">
                Base year
                <input type="number" value={comparisonYear1} onChange={(event) => setComparisonYear1(Number(event.target.value))} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-500">
                Compare year
                <input type="number" value={comparisonYear2} onChange={(event) => setComparisonYear2(Number(event.target.value))} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
              </label>
            </div>
            {comparisonYear1 === comparisonYear2 ? <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Select two different years.</div> : null}
          </section>
          <TableShell title="Year comparison" loading={comparisonQuery.isLoading} empty={(comparison?.rows ?? []).length === 0}>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Period</th>
                  <th className="px-4 py-2 text-right font-medium">{comparisonYear1}</th>
                  <th className="px-4 py-2 text-right font-medium">{comparisonYear2}</th>
                  <th className="px-4 py-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(comparison?.rows ?? []).map((row) => (
                  <tr key={row.period}>
                    <td className="px-4 py-2 font-medium">{comparisonPeriod === "monthly" ? monthName(row.period) : row.period}</td>
                    <td className="px-4 py-2 text-right">{formatComparisonValue(comparisonMetric, row.year1Value)}</td>
                    <td className="px-4 py-2 text-right">{formatComparisonValue(comparisonMetric, row.year2Value)}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${comparisonBadgeClass(row.changePct)}`}>
                        {row.changePct === null ? "New" : `${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(1)}%`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>
      )}

      {tab === "tally" && (
        <section className="rounded-md border border-border bg-white p-5">
          <h2 className="text-base font-semibold text-slate-950">Tally Prime XML export</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Downloads sales vouchers for confirmed invoices, purchase vouchers for received purchase orders, and payment vouchers for expenses in the selected date range.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MetricCard label="From" value={from} />
            <MetricCard label="To" value={to} />
            <button type="button" className="h-full min-h-20 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white" onClick={() => void downloadTallyExport()}>
              Download XML
            </button>
          </div>
        </section>
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

function ExportButton({ label, onClick, disabled = false }: Readonly<{ label: string; onClick: () => void; disabled?: boolean }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 rounded-md border border-border px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function MetricCard({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-slate-950">{value}</div>
    </div>
  );
}

function TableShell({
  title,
  loading,
  empty,
  children,
}: Readonly<{ title: string; loading: boolean; empty: boolean; children: React.ReactNode }>) {
  return (
    <section className="rounded-md border border-border bg-white">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">{title}</div>
      {loading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-10 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>
      ) : empty ? (
        <div className="p-6 text-sm text-slate-400">No data for this filter.</div>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </section>
  );
}

function money(v: number) {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function stockMovementQueryString(from: string, to: string, productId: string, type: string, format?: "csv" | "xlsx"): string {
  const query = new URLSearchParams({ from, to, limit: "50" });
  if (productId) {
    query.set("productId", productId);
  }
  if (type) {
    query.set("type", type);
  }
  if (format) {
    query.set("format", format);
  }
  return query.toString();
}

function agingBucketWidth(value: number, buckets: Array<{ totalOutstanding: number }>): number {
  const total = buckets.reduce((sum, bucket) => sum + bucket.totalOutstanding, 0);
  if (total <= 0) {
    return buckets.length > 0 ? 100 / buckets.length : 0;
  }

  return Math.max((value / total) * 100, value > 0 ? 4 : 0);
}

function agingBucketBarClass(index: number): string {
  return ["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-red-500"][index] ?? "bg-slate-300";
}

function agingBucketDotClass(index: number): string {
  return ["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-red-500"][index] ?? "bg-slate-300";
}

function monthName(value: string): string {
  const month = Number(value);
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return value;
  }

  return new Date(Date.UTC(2026, month - 1, 1)).toLocaleString("en-IN", { month: "short" });
}

function formatComparisonValue(metric: ComparisonReport["metric"], value: number): string {
  if (metric === "revenue" || metric === "expenses") {
    return money(value);
  }

  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function comparisonBadgeClass(value: number | null): string {
  if (value === null) {
    return "bg-blue-50 text-blue-700";
  }

  return value >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700";
}
