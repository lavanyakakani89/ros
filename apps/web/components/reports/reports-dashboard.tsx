"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { StatStrip } from "@/components/shared/stat-strip";
import { createAuthenticatedApiClient, downloadApiFile, listProducts } from "@/lib/api-client";
import { getStoredAuthSession, getStoredTenant } from "@/lib/vertical-config";

type Tab =
  | "overview"
  | "sales"
  | "purchases"
  | "payments"
  | "expenses"
  | "inventory"
  | "pnl"
  | "gstr"
  | "dayend"
  | "customers"
  | "suppliers"
  | "aging"
  | "stock"
  | "comparison"
  | "tally";

type ComparisonMetric = "revenue" | "invoices" | "customers" | "expenses";
type ComparisonPeriod = "monthly" | "weekly";

interface StoreOption {
  id: string;
  name: string;
  isDefault?: boolean;
}

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

interface OverviewReport {
  metrics: {
    grossSales: number;
    netSales: number;
    invoiceCount: number;
    averageBillValue: number;
    grossProfit: number;
    grossMarginPct: number;
    purchaseTotal: number;
    pendingPurchaseTotal: number;
    expenseTotal: number;
    collections: number;
    receivables: number;
    supplierPayables: number;
    stockValue: number;
    lowStockCount: number;
  };
  deltas: {
    netSalesPct: number | null;
    grossProfitPct: number | null;
    purchaseTotalPct: number | null;
    expenseTotalPct: number | null;
    collectionsPct: number | null;
  };
  trends: {
    revenue: Array<{ date: string; value: number }>;
    purchases: Array<{ date: string; value: number }>;
    expenses: Array<{ date: string; value: number }>;
    collections: Array<{ date: string; value: number }>;
  };
  topProducts: Array<{ productName: string; quantitySold: number; totalSales: number }>;
  topCustomers: Array<{ id: string; name: string; revenue: number; outstanding: number; invoices: number }>;
  topSuppliers: Array<{ id: string; name: string; purchased: number; outstanding: number; purchaseOrders: number }>;
  storeBreakdown: Array<{
    storeId: string;
    storeName: string;
    invoices: number;
    sales: number;
    purchases: number;
    expenses: number;
    collections: number;
  }>;
}

interface InventoryReport {
  stockValue: number;
  lowStockCount: number;
  stockByCategory: Array<{ category: string; products: number; stock: number }>;
}

interface PnlReport {
  revenue: number;
  cost: number;
  grossProfit: number;
  grossMarginPct: number;
  items: Array<{ productName: string; quantitySold: number; revenue: number; cost: number; profit: number; marginPct: number }>;
}

interface PurchaseAnalyticsReport {
  totalReceived: number;
  totalPaid: number;
  totalReturns: number;
  totalOutstanding: number;
  receivedPoCount: number;
  pendingPoCount: number;
  pendingAmount: number;
  dailyPurchases: Array<{ date: string; value: number }>;
  suppliers: PaginatedReport<{
    id: string;
    name: string;
    totalPurchased: number;
    totalPaid: number;
    outstanding: number;
    purchaseOrders: number;
    returned: number;
  }>;
  topSuppliers: Array<{
    id: string;
    name: string;
    totalPurchased: number;
    totalPaid: number;
    outstanding: number;
    purchaseOrders: number;
    returned: number;
  }>;
}

interface PaymentAnalyticsReport {
  collectionTotal: number;
  refundTotal: number;
  netCollection: number;
  transactionCount: number;
  voidCount: number;
  outstandingDue: number;
  settlementSummary: {
    draft: number;
    reviewed: number;
    settled: number;
  };
  dailyCollections: Array<{ date: string; value: number }>;
  methods: PaginatedReport<{
    id: string;
    name: string;
    shortCode: string;
    color: string;
    total: number;
    count: number;
  }>;
}

interface ExpenseAnalyticsReport {
  totalExpenses: number;
  expenseCount: number;
  averageExpense: number;
  dailyExpenses: Array<{ date: string; value: number }>;
  categories: PaginatedReport<{ category: string; total: number; count: number }>;
  topCategories: Array<{ category: string; total: number; count: number }>;
}

interface DayEndReport {
  date: string;
  openingCash: number;
  salesCash: number;
  salesUpi: number;
  salesCard: number;
  salesCredit: number;
  salesNetbanking?: number;
  totalCollection: number;
  invoiceCount: number;
  refunds: number;
  closingCash: number;
  paymentMethods?: Array<{ id: string; name: string; total: number; count: number }>;
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
  metric: ComparisonMetric;
  period: ComparisonPeriod;
  year1: number;
  year2: number;
  rows: Array<{
    period: string;
    year1Value: number;
    year2Value: number;
    changePct: number | null;
  }>;
}

interface ProductLookup {
  id: string;
  name: string;
  barcode?: string | null;
  sku?: string | null;
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export function ReportsDashboard() {
  const searchParams = useSearchParams();
  const sessionRole = getStoredAuthSession()?.user?.role ?? "STAFF";
  const canViewReports = sessionRole === "OWNER" || sessionRole === "MANAGER";
  const canViewFinancial = sessionRole === "OWNER" || sessionRole === "MANAGER";
  const currentYear = new Date().getFullYear();
  const initialTab = (searchParams?.get("tab") as Tab | null) ?? "overview";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [from, setFrom] = useState(isoDaysAgo(6));
  const [to, setTo] = useState(isoToday());
  const [storeId, setStoreId] = useState("");
  const [gstEnabled, setGstEnabled] = useState(true);
  const [stockProductSearch, setStockProductSearch] = useState("");
  const deferredStockSearch = useDeferredValue(stockProductSearch.trim());
  const [stockProductId, setStockProductId] = useState("");
  const [stockMovementType, setStockMovementType] = useState("");
  const [comparisonMetric, setComparisonMetric] = useState<ComparisonMetric>("revenue");
  const [comparisonPeriod, setComparisonPeriod] = useState<ComparisonPeriod>("monthly");
  const [comparisonYear1, setComparisonYear1] = useState(currentYear - 1);
  const [comparisonYear2, setComparisonYear2] = useState(currentYear);
  const api = createAuthenticatedApiClient();

  useEffect(() => {
    const enabled = getStoredTenant()?.gstEnabled !== false;
    setGstEnabled(enabled);
    if (!enabled && tab === "gstr") {
      setTab("overview");
    }
    if (!canViewFinancial && (tab === "pnl" || tab === "payments" || tab === "expenses" || tab === "purchases")) {
      setTab("overview");
    }
  }, [canViewFinancial, tab]);

  const storesQuery = useQuery({
    queryKey: ["report-stores"],
    queryFn: () => api.get<StoreOption[]>("/settings/stores"),
    enabled: canViewReports,
  });

  const overviewQuery = useQuery({
    queryKey: ["reports-overview", from, to, storeId],
    queryFn: () => api.get<OverviewReport>(`/reports/overview?${dateRangeQuery(from, to, storeId)}`),
    enabled: canViewReports && tab === "overview",
  });

  const summaryQuery = useQuery({
    queryKey: ["reports-summary", from, to, storeId],
    queryFn: () => api.get<ReportSummary>(`/reports/summary?${dateRangeQuery(from, to, storeId)}`),
    enabled: canViewReports && (tab === "sales" || tab === "gstr"),
  });

  const purchaseQuery = useQuery({
    queryKey: ["reports-purchases", from, to, storeId],
    queryFn: () => api.get<PurchaseAnalyticsReport>(`/reports/purchase-analytics?${dateRangeQuery(from, to, storeId, { limit: "25" })}`),
    enabled: canViewFinancial && tab === "purchases",
  });

  const paymentQuery = useQuery({
    queryKey: ["reports-payments", from, to, storeId],
    queryFn: () => api.get<PaymentAnalyticsReport>(`/reports/payment-analytics?${dateRangeQuery(from, to, storeId, { limit: "25" })}`),
    enabled: canViewFinancial && tab === "payments",
  });

  const expenseQuery = useQuery({
    queryKey: ["reports-expenses", from, to, storeId],
    queryFn: () => api.get<ExpenseAnalyticsReport>(`/reports/expense-analytics?${dateRangeQuery(from, to, storeId, { limit: "25" })}`),
    enabled: canViewFinancial && tab === "expenses",
  });

  const inventoryQuery = useQuery({
    queryKey: ["reports-inventory"],
    queryFn: () => api.get<InventoryReport>("/reports/inventory"),
    enabled: canViewReports && tab === "inventory",
  });

  const pnlQuery = useQuery({
    queryKey: ["reports-pnl", from, to, storeId],
    queryFn: () => api.get<PnlReport>(`/reports/pnl?${dateRangeQuery(from, to, storeId)}`),
    enabled: canViewFinancial && tab === "pnl",
  });

  const dayEndQuery = useQuery({
    queryKey: ["reports-day-end", to],
    queryFn: () => api.get<DayEndReport>(`/reports/day-end?date=${to}`),
    enabled: canViewReports && tab === "dayend",
  });

  const customerSalesQuery = useQuery({
    queryKey: ["reports-customers", from, to, storeId],
    queryFn: () => api.get<PaginatedReport<CustomerSalesReportRow>>(`/reports/customer-sales?${dateRangeQuery(from, to, storeId, { limit: "50", sortBy: "revenue" })}`),
    enabled: canViewReports && tab === "customers",
  });

  const supplierPurchasesQuery = useQuery({
    queryKey: ["reports-suppliers", from, to, storeId],
    queryFn: () => api.get<PaginatedReport<SupplierPurchasesReportRow>>(`/reports/supplier-purchases?${dateRangeQuery(from, to, storeId, { limit: "50" })}`),
    enabled: canViewReports && tab === "suppliers",
  });

  const agingQuery = useQuery({
    queryKey: ["reports-aging", storeId],
    queryFn: () => api.get<AgingReport>(`/reports/outstanding-aging?${optionalStoreQuery(storeId)}`),
    enabled: canViewReports && tab === "aging",
  });

  const stockMovementQuery = useQuery({
    queryKey: ["reports-stock", from, to, storeId, stockProductId, stockMovementType],
    queryFn: () => api.get<PaginatedReport<StockMovementReportRow>>(`/reports/stock-movement?${stockMovementQueryString(from, to, storeId, stockProductId, stockMovementType)}`),
    enabled: canViewReports && tab === "stock",
  });

  const stockProductSearchQuery = useQuery({
    queryKey: ["reports-stock-product-search", deferredStockSearch],
    queryFn: () => listProducts({ search: deferredStockSearch, limit: 20 }),
    enabled: canViewReports && tab === "stock" && deferredStockSearch.length > 0,
  });

  const comparisonQuery = useQuery({
    queryKey: ["reports-comparison", comparisonMetric, comparisonPeriod, comparisonYear1, comparisonYear2, storeId],
    queryFn: () => api.get<ComparisonReport>(`/reports/comparison?${comparisonQueryString(comparisonMetric, comparisonPeriod, comparisonYear1, comparisonYear2, storeId)}`),
    enabled: canViewReports && tab === "comparison" && comparisonYear1 !== comparisonYear2,
  });

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "sales", label: "Sales" },
    ...(canViewFinancial ? [{ id: "purchases" as const, label: "Purchases" }] : []),
    ...(canViewFinancial ? [{ id: "payments" as const, label: "Payments" }] : []),
    ...(canViewFinancial ? [{ id: "expenses" as const, label: "Expenses" }] : []),
    { id: "inventory", label: "Inventory" },
    ...(canViewFinancial ? [{ id: "pnl" as const, label: "P&L" }] : []),
    ...(gstEnabled ? [{ id: "gstr" as const, label: "GST" }] : []),
    { id: "dayend", label: "Day-end" },
    { id: "customers", label: "Customers" },
    { id: "suppliers", label: "Suppliers" },
    { id: "aging", label: "Aging" },
    { id: "stock", label: "Stock" },
    { id: "comparison", label: "Compare" },
    { id: "tally", label: "Tally" },
  ];

  if (!canViewReports) {
    return (
      <section className="rounded-md border border-border bg-white p-6 text-sm text-slate-500">
        Reports are available to owners and managers.
      </section>
    );
  }

  const storeOptions = storesQuery.data ?? [];
  const overview = overviewQuery.data;
  const summary = summaryQuery.data;
  const purchases = purchaseQuery.data;
  const payments = paymentQuery.data;
  const expenses = expenseQuery.data;
  const inventory = inventoryQuery.data;
  const pnl = pnlQuery.data;
  const dayEnd = dayEndQuery.data;
  const customers = customerSalesQuery.data;
  const suppliers = supplierPurchasesQuery.data;
  const aging = agingQuery.data;
  const stockMovement = stockMovementQuery.data;
  const comparison = comparisonQuery.data;
  const stockProductResults = (stockProductSearchQuery.data?.data ?? []) as ProductLookup[];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${tab === item.id ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500 hover:text-slate-700"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <ReportsToolbar
        tab={tab}
        from={from}
        to={to}
        storeId={storeId}
        stores={storeOptions}
        onFromChange={setFrom}
        onToChange={setTo}
        onStoreChange={setStoreId}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/reports/payment-methods" className="h-9 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Payment statements
        </Link>
        <Link href="/reports/settlements" className="h-9 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Settlements
        </Link>
        {tab === "overview" ? (
          <>
            <ExportButton label="Overview CSV" onClick={() => void downloadReport("overview", from, to, storeId, "csv")} />
            <ExportButton label="Overview Excel" onClick={() => void downloadReport("overview", from, to, storeId, "xlsx")} />
          </>
        ) : null}
        {tab === "sales" ? (
          <>
            <ExportButton label="Summary CSV" onClick={() => void downloadReport("summary", from, to, storeId, "csv")} />
            <ExportButton label="Daily Excel" onClick={() => void downloadReport("daily-sales", from, to, storeId, "xlsx")} />
            <ExportButton label="Moving items CSV" onClick={() => void downloadReport("moving-items", from, to, storeId, "csv")} />
          </>
        ) : null}
        {tab === "purchases" ? (
          <>
            <ExportButton label="Purchases CSV" onClick={() => void downloadReport("purchase-analytics", from, to, storeId, "csv")} />
            <ExportButton label="Purchases Excel" onClick={() => void downloadReport("purchase-analytics", from, to, storeId, "xlsx")} />
          </>
        ) : null}
        {tab === "payments" ? (
          <>
            <ExportButton label="Payments CSV" onClick={() => void downloadReport("payment-analytics", from, to, storeId, "csv")} />
            <ExportButton label="Payments Excel" onClick={() => void downloadReport("payment-analytics", from, to, storeId, "xlsx")} />
          </>
        ) : null}
        {tab === "expenses" ? (
          <>
            <ExportButton label="Expenses CSV" onClick={() => void downloadReport("expense-analytics", from, to, storeId, "csv")} />
            <ExportButton label="Expenses Excel" onClick={() => void downloadReport("expense-analytics", from, to, storeId, "xlsx")} />
          </>
        ) : null}
        {tab === "inventory" ? (
          <>
            <ExportButton label="Inventory CSV" onClick={() => void downloadApiFile("/reports/inventory/export?format=csv", "inventory.csv")} />
            <ExportButton label="Inventory Excel" onClick={() => void downloadApiFile("/reports/inventory/export?format=xlsx", "inventory.xlsx")} />
          </>
        ) : null}
        {tab === "pnl" ? (
          <>
            <ExportButton label="P&L CSV" onClick={() => void downloadReport("pnl", from, to, storeId, "csv")} />
            <ExportButton label="P&L Excel" onClick={() => void downloadReport("pnl", from, to, storeId, "xlsx")} />
          </>
        ) : null}
        {tab === "gstr" ? (
          <>
            <ExportButton label="GST CSV" onClick={() => void downloadReport("gst", from, to, storeId, "csv")} />
            <ExportButton label="GST Excel" onClick={() => void downloadReport("gst", from, to, storeId, "xlsx")} />
          </>
        ) : null}
        {tab === "customers" ? (
          <>
            <ExportButton label="Customer CSV" onClick={() => void downloadReport("customer-sales", from, to, storeId, "csv")} />
            <ExportButton label="Customer Excel" onClick={() => void downloadReport("customer-sales", from, to, storeId, "xlsx")} />
          </>
        ) : null}
        {tab === "suppliers" ? (
          <>
            <ExportButton label="Supplier CSV" onClick={() => void downloadReport("supplier-purchases", from, to, storeId, "csv")} />
            <ExportButton label="Supplier Excel" onClick={() => void downloadReport("supplier-purchases", from, to, storeId, "xlsx")} />
          </>
        ) : null}
        {tab === "aging" ? (
          <>
            <ExportButton label="Aging CSV" onClick={() => void downloadReport("outstanding-aging", from, to, storeId, "csv")} />
            <ExportButton label="Aging Excel" onClick={() => void downloadReport("outstanding-aging", from, to, storeId, "xlsx")} />
          </>
        ) : null}
        {tab === "stock" ? (
          <ExportButton label="Stock CSV" onClick={() => void downloadApiFile(`/reports/stock-movement/export?${stockMovementQueryString(from, to, storeId, stockProductId, stockMovementType, "csv")}`, `stock-movement-${from}-${to}.csv`)} />
        ) : null}
        {tab === "tally" ? (
          <ExportButton label="Download XML" onClick={() => void downloadApiFile(`/reports/tally-export?${dateRangeQuery(from, to, storeId)}`, `tally-export-${from}-${to}.xml`)} />
        ) : null}
      </div>

      {tab === "overview" ? (
        <div className="space-y-4">
          <StatStrip
            items={[
              { label: "Net sales", value: money(overview?.metrics.netSales ?? 0), tone: "emerald" },
              { label: "Gross profit", value: money(overview?.metrics.grossProfit ?? 0), tone: "blue" },
              { label: "Purchases", value: money(overview?.metrics.purchaseTotal ?? 0), tone: "amber" },
              { label: "Collections", value: money(overview?.metrics.collections ?? 0), tone: "slate" },
              { label: "Expenses", value: money(overview?.metrics.expenseTotal ?? 0), tone: "amber" },
              { label: "Receivables", value: money(overview?.metrics.receivables ?? 0), tone: "slate" },
              { label: "Supplier payables", value: money(overview?.metrics.supplierPayables ?? 0), tone: "amber" },
              { label: "Stock value", value: money(overview?.metrics.stockValue ?? 0), tone: "blue" },
            ]}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Revenue vs purchases vs expenses">
              <LineChart data={mergeTrendSeries(overview)}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Line type="monotone" dataKey="revenue" stroke="#059669" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="purchases" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expenses" stroke="#f97316" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartCard>
            <ChartCard title="Collections trend">
              <BarChart data={(overview?.trends.collections ?? []).map((item) => ({ date: item.date.slice(5), value: item.value }))}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Bar dataKey="value" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <SummaryList
              title="Top products"
              items={(overview?.topProducts ?? []).map((item) => formatSummaryParts(item.productName, `${String(item.quantitySold)} units`, money(item.totalSales)))}
            />
            <SummaryList
              title="Top customers"
              items={(overview?.topCustomers ?? []).map((item) => `${item.name} · ${money(item.revenue)} · due ${money(item.outstanding)}`)}
            />
            <SummaryList
              title="Top suppliers"
              items={(overview?.topSuppliers ?? []).map((item) => `${item.name} · ${money(item.purchased)} · due ${money(item.outstanding)}`)}
            />
          </div>
          <TableShell title="Store breakdown" loading={overviewQuery.isLoading} empty={(overview?.storeBreakdown ?? []).length === 0}>
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Store</th>
                  <th className="px-4 py-2 text-right font-medium">Invoices</th>
                  <th className="px-4 py-2 text-right font-medium">Sales</th>
                  <th className="px-4 py-2 text-right font-medium">Purchases</th>
                  <th className="px-4 py-2 text-right font-medium">Expenses</th>
                  <th className="px-4 py-2 text-right font-medium">Collections</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(overview?.storeBreakdown ?? []).map((row) => (
                  <tr key={row.storeId}>
                    <td className="px-4 py-2 font-medium">{row.storeName}</td>
                    <td className="px-4 py-2 text-right">{row.invoices}</td>
                    <td className="px-4 py-2 text-right">{money(row.sales)}</td>
                    <td className="px-4 py-2 text-right">{money(row.purchases)}</td>
                    <td className="px-4 py-2 text-right">{money(row.expenses)}</td>
                    <td className="px-4 py-2 text-right">{money(row.collections)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>
      ) : null}

      {tab === "sales" ? (
        <div className="space-y-4">
          <StatStrip
            items={[
              { label: "Gross sales", value: money(summary?.grossSales ?? 0), tone: "emerald" },
              { label: "Net sales", value: money(summary?.netSales ?? 0), tone: "blue" },
              { label: "Invoices", value: String(summary?.invoiceCount ?? 0), tone: "slate" },
              { label: "Collected", value: money(summary?.paid ?? 0), tone: "amber" },
            ]}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Daily sales">
              <LineChart data={(summary?.dailySales ?? []).map((item) => ({ date: item.date.slice(5), sales: item.sales, invoices: item.invoices }))}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Line type="monotone" dataKey="sales" stroke="#059669" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="invoices" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartCard>
            <SummaryList title="Fast-moving items" items={(summary?.movingItems ?? []).map((item) => formatSummaryParts(item.productName, `${String(item.quantitySold)} units`, money(item.totalSales)))} />
          </div>
        </div>
      ) : null}

      {tab === "purchases" ? (
        <div className="space-y-4">
          <StatStrip
            items={[
              { label: "Received", value: money(purchases?.totalReceived ?? 0), tone: "blue" },
              { label: "Paid", value: money(purchases?.totalPaid ?? 0), tone: "emerald" },
              { label: "Outstanding", value: money(purchases?.totalOutstanding ?? 0), tone: "amber" },
              { label: "Pending PO value", value: money(purchases?.pendingAmount ?? 0), tone: "slate" },
            ]}
          />
          <ChartCard title="Daily purchases">
            <BarChart data={(purchases?.dailyPurchases ?? []).map((item) => ({ date: item.date.slice(5), value: item.value }))}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip formatter={(value) => money(Number(value))} />
              <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
          <TableShell title="Supplier purchase analytics" loading={purchaseQuery.isLoading} empty={(purchases?.suppliers.data ?? []).length === 0}>
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Supplier</th>
                  <th className="px-4 py-2 text-right font-medium">POs</th>
                  <th className="px-4 py-2 text-right font-medium">Purchased</th>
                  <th className="px-4 py-2 text-right font-medium">Returned</th>
                  <th className="px-4 py-2 text-right font-medium">Paid</th>
                  <th className="px-4 py-2 text-right font-medium">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(purchases?.suppliers.data ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2 font-medium">{row.name}</td>
                    <td className="px-4 py-2 text-right">{row.purchaseOrders}</td>
                    <td className="px-4 py-2 text-right">{money(row.totalPurchased)}</td>
                    <td className="px-4 py-2 text-right">{money(row.returned)}</td>
                    <td className="px-4 py-2 text-right">{money(row.totalPaid)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-amber-700">{money(row.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>
      ) : null}

      {tab === "payments" ? (
        <div className="space-y-4">
          <StatStrip
            items={[
              { label: "Collections", value: money(payments?.collectionTotal ?? 0), tone: "emerald" },
              { label: "Refunds", value: money(payments?.refundTotal ?? 0), tone: "amber" },
              { label: "Net collection", value: money(payments?.netCollection ?? 0), tone: "blue" },
              { label: "Outstanding due", value: money(payments?.outstandingDue ?? 0), tone: "slate" },
            ]}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Daily collections">
              <LineChart data={(payments?.dailyCollections ?? []).map((item) => ({ date: item.date.slice(5), value: item.value }))}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Line type="monotone" dataKey="value" stroke="#1d4ed8" strokeWidth={3} dot={false} />
              </LineChart>
            </ChartCard>
            <section className="rounded-md border border-border bg-white p-4">
              <div className="mb-3 text-sm font-semibold text-slate-950">Settlement status</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label="Draft" value={String(payments?.settlementSummary.draft ?? 0)} />
                <MetricCard label="Reviewed" value={String(payments?.settlementSummary.reviewed ?? 0)} />
                <MetricCard label="Settled" value={String(payments?.settlementSummary.settled ?? 0)} />
              </div>
            </section>
          </div>
          <TableShell title="Payment method mix" loading={paymentQuery.isLoading} empty={(payments?.methods.data ?? []).length === 0}>
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Method</th>
                  <th className="px-4 py-2 text-right font-medium">Transactions</th>
                  <th className="px-4 py-2 text-right font-medium">Collected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(payments?.methods.data ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2 font-medium">{row.name}</td>
                    <td className="px-4 py-2 text-right">{row.count}</td>
                    <td className="px-4 py-2 text-right">{money(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>
      ) : null}

      {tab === "expenses" ? (
        <div className="space-y-4">
          <StatStrip
            items={[
              { label: "Total expenses", value: money(expenses?.totalExpenses ?? 0), tone: "amber" },
              { label: "Entries", value: String(expenses?.expenseCount ?? 0), tone: "slate" },
              { label: "Average expense", value: money(expenses?.averageExpense ?? 0), tone: "blue" },
              { label: "Top category", value: expenses?.topCategories[0]?.category ?? "-", tone: "emerald" },
            ]}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Daily expenses">
              <BarChart data={(expenses?.dailyExpenses ?? []).map((item) => ({ date: item.date.slice(5), value: item.value }))}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Bar dataKey="value" fill="#ea580c" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
            <SummaryList title="Top categories" items={(expenses?.topCategories ?? []).map((item) => formatSummaryParts(item.category, money(item.total), `${String(item.count)} entries`))} />
          </div>
          <TableShell title="Expense categories" loading={expenseQuery.isLoading} empty={(expenses?.categories.data ?? []).length === 0}>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Category</th>
                  <th className="px-4 py-2 text-right font-medium">Entries</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(expenses?.categories.data ?? []).map((row) => (
                  <tr key={row.category}>
                    <td className="px-4 py-2 font-medium">{row.category}</td>
                    <td className="px-4 py-2 text-right">{row.count}</td>
                    <td className="px-4 py-2 text-right">{money(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>
      ) : null}

      {tab === "inventory" ? (
        <div className="space-y-4">
          <StatStrip
            items={[
              { label: "Stock value", value: money(inventory?.stockValue ?? 0), tone: "blue" },
              { label: "Low stock items", value: String(inventory?.lowStockCount ?? 0), tone: "amber" },
              { label: "Categories", value: String(inventory?.stockByCategory.length ?? 0), tone: "slate" },
              { label: "Top category", value: inventory?.stockByCategory[0]?.category ?? "-", tone: "emerald" },
            ]}
          />
          <ChartCard title="Stock by category">
            <BarChart data={(inventory?.stockByCategory ?? []).slice(0, 10).map((item) => ({ category: item.category, stock: item.stock }))}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="category" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar dataKey="stock" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
        </div>
      ) : null}

      {tab === "pnl" ? (
        <div className="space-y-4">
          <StatStrip
            items={[
              { label: "Revenue", value: money(pnl?.revenue ?? 0), tone: "emerald" },
              { label: "Cost", value: money(pnl?.cost ?? 0), tone: "amber" },
              { label: "Gross profit", value: money(pnl?.grossProfit ?? 0), tone: "blue" },
              { label: "Margin", value: `${(pnl?.grossMarginPct ?? 0).toFixed(1)}%`, tone: "slate" },
            ]}
          />
          <TableShell title="Product profitability" loading={pnlQuery.isLoading} empty={(pnl?.items ?? []).length === 0}>
            <table className="w-full min-w-[840px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Product</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Revenue</th>
                  <th className="px-4 py-2 text-right font-medium">Cost</th>
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
                    <td className="px-4 py-2 text-right">{money(item.cost)}</td>
                    <td className="px-4 py-2 text-right">{money(item.profit)}</td>
                    <td className="px-4 py-2 text-right">{item.marginPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>
      ) : null}

      {tab === "gstr" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <SummaryList title="GST by rate" items={(summary?.gstByRate ?? []).map((item) => formatSummaryParts(`${String(item.gstRate)}%`, money(item.totalGst), `taxable ${money(item.taxableValue)}`))} />
          <SummaryList title="HSN summary" items={(summary?.hsnSummary ?? []).map((item) => `${item.hsnCode} · ${money(item.totalSales)} · GST ${money(item.totalGst)}`)} />
        </div>
      ) : null}

      {tab === "dayend" ? (
        <div className="space-y-4">
          <StatStrip
            items={[
              { label: "Cash", value: money(dayEnd?.salesCash ?? 0), tone: "emerald" },
              { label: "UPI", value: money(dayEnd?.salesUpi ?? 0), tone: "blue" },
              { label: "Card", value: money(dayEnd?.salesCard ?? 0), tone: "slate" },
              { label: "Closing cash", value: money(dayEnd?.closingCash ?? 0), tone: "amber" },
            ]}
          />
          <SummaryList title="Payment methods" items={(dayEnd?.paymentMethods ?? []).map((item) => formatSummaryParts(item.name, money(item.total), `${String(item.count)} txns`))} />
        </div>
      ) : null}

      {tab === "customers" ? (
        <TableShell title="Customer sales" loading={customerSalesQuery.isLoading} empty={(customers?.data ?? []).length === 0}>
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
              {(customers?.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2"><span className="font-medium">{row.name}</span><span className="block text-xs text-slate-400">{row.phone}</span></td>
                  <td className="px-4 py-2 text-right">{row.invoiceCount}</td>
                  <td className="px-4 py-2 text-right">{money(row.totalRevenue)}</td>
                  <td className="px-4 py-2 text-right">{money(row.totalPaid)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-amber-700">{money(row.outstanding)}</td>
                  <td className="px-4 py-2 text-right">{row.lastPurchaseDate ? new Date(row.lastPurchaseDate).toLocaleDateString("en-IN") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      ) : null}

      {tab === "suppliers" ? (
        <TableShell title="Supplier purchases" loading={supplierPurchasesQuery.isLoading} empty={(suppliers?.data ?? []).length === 0}>
          <table className="w-full min-w-[720px] text-sm">
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
              {(suppliers?.data ?? []).map((row) => (
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
      ) : null}

      {tab === "aging" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            {(aging?.buckets ?? []).map((bucket) => (
              <MetricCard key={bucket.bucket} label={`${bucket.bucket} days`} value={formatSummaryParts(money(bucket.totalOutstanding), `${String(bucket.customerCount)} customers`)} />
            ))}
          </div>
          <TableShell title="Outstanding aging" loading={agingQuery.isLoading} empty={(aging?.customers ?? []).length === 0}>
            <table className="w-full min-w-[760px] text-sm">
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
      ) : null}

      {tab === "stock" ? (
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
                {deferredStockSearch && stockProductResults.length > 0 ? (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-white shadow-lg">
                    {stockProductResults.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-emerald-50"
                        onClick={() => {
                          setStockProductId(product.id);
                          setStockProductSearch(product.name);
                        }}
                      >
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
              <button
                type="button"
                className="h-10 self-end rounded-md border border-border px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setStockProductSearch("");
                  setStockProductId("");
                  setStockMovementType("");
                }}
              >
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
                  <tr key={[row.productId, row.reference, row.date, String(index)].join("-")}>
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
      ) : null}

      {tab === "comparison" ? (
        <div className="space-y-4">
          <section className="rounded-md border border-border bg-white p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs font-medium text-slate-500">
                Metric
                <select value={comparisonMetric} onChange={(event) => setComparisonMetric(event.target.value as ComparisonMetric)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm">
                  <option value="revenue">Revenue</option>
                  <option value="invoices">Invoices</option>
                  <option value="customers">New customers</option>
                  <option value="expenses">Expenses</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-500">
                Period
                <select value={comparisonPeriod} onChange={(event) => setComparisonPeriod(event.target.value as ComparisonPeriod)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm">
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
                    <td className="px-4 py-2 text-right">{row.changePct == null ? "New" : `${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>
      ) : null}

      {tab === "tally" ? (
        <section className="rounded-md border border-border bg-white p-5">
          <h2 className="text-base font-semibold text-slate-950">Tally Prime XML export</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Downloads sales, purchase, and expense vouchers for the selected period.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MetricCard label="From" value={from} />
            <MetricCard label="To" value={to} />
            <button type="button" className="h-full min-h-20 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white" onClick={() => void downloadApiFile(`/reports/tally-export?${dateRangeQuery(from, to, storeId)}`, `tally-export-${from}-${to}.xml`)}>
              Download XML
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ReportsToolbar({
  tab,
  from,
  to,
  storeId,
  stores,
  onFromChange,
  onToChange,
  onStoreChange,
}: Readonly<{
  tab: Tab;
  from: string;
  to: string;
  storeId: string;
  stores: StoreOption[];
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onStoreChange: (value: string) => void;
}>) {
  const hideDateFilter = tab === "inventory" || tab === "aging" || tab === "comparison";

  return (
    <div className="flex flex-wrap items-center gap-3">
      {!hideDateFilter ? (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            From
            <input type="date" value={from} onChange={(event) => onFromChange(event.target.value)} className="h-9 rounded-md border border-border px-3 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            To
            <input type="date" value={to} onChange={(event) => onToChange(event.target.value)} className="h-9 rounded-md border border-border px-3 text-sm" />
          </label>
          <button type="button" className="h-9 rounded-md border border-border px-3 text-sm text-slate-600 hover:bg-slate-50" onClick={() => {
            onFromChange(isoToday());
            onToChange(isoToday());
          }}>
            Today
          </button>
          <button type="button" className="h-9 rounded-md border border-border px-3 text-sm text-slate-600 hover:bg-slate-50" onClick={() => {
            onFromChange(isoDaysAgo(6));
            onToChange(isoToday());
          }}>
            Last 7d
          </button>
          <button type="button" className="h-9 rounded-md border border-border px-3 text-sm text-slate-600 hover:bg-slate-50" onClick={() => {
            const now = new Date();
            onFromChange(`${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
            onToChange(isoToday());
          }}>
            This month
          </button>
        </>
      ) : null}
      {stores.length > 1 ? (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Store
          <select value={storeId} onChange={(event) => onStoreChange(event.target.value)} className="h-9 rounded-md border border-border bg-white px-3 text-sm">
            <option value="">All stores</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function ChartCard({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="rounded-md border border-border bg-white p-4">
      <div className="mb-4 text-sm font-semibold text-slate-950">{title}</div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function SummaryList({ title, items }: Readonly<{ title: string; items: string[] }>) {
  return (
    <section className="rounded-md border border-border bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-slate-950">{title}</div>
      <div className="space-y-2">
        {items.length > 0 ? items.map((item) => (
          <div key={item} className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {item}
          </div>
        )) : (
          <div className="text-sm text-slate-400">No data yet.</div>
        )}
      </div>
    </section>
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

function ExportButton({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <button type="button" onClick={onClick} className="h-9 rounded-md border border-border px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
      {label}
    </button>
  );
}

function MetricCard({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-slate-950">{value}</div>
    </div>
  );
}

function mergeTrendSeries(overview: OverviewReport | undefined) {
  if (!overview) {
    return [];
  }

  const rows = new Map<string, { date: string; revenue: number; purchases: number; expenses: number }>();
  for (const item of overview.trends.revenue) {
    rows.set(item.date, { date: item.date.slice(5), revenue: item.value, purchases: 0, expenses: 0 });
  }
  for (const item of overview.trends.purchases) {
    const current = rows.get(item.date) ?? { date: item.date.slice(5), revenue: 0, purchases: 0, expenses: 0 };
    current.purchases = item.value;
    rows.set(item.date, current);
  }
  for (const item of overview.trends.expenses) {
    const current = rows.get(item.date) ?? { date: item.date.slice(5), revenue: 0, purchases: 0, expenses: 0 };
    current.expenses = item.value;
    rows.set(item.date, current);
  }
  return [...rows.values()];
}

function dateRangeQuery(from: string, to: string, storeId: string, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ from, to, ...extra });
  if (storeId) {
    query.set("storeId", storeId);
  }
  return query.toString();
}

function optionalStoreQuery(storeId: string) {
  const query = new URLSearchParams();
  if (storeId) {
    query.set("storeId", storeId);
  }
  return query.toString();
}

function stockMovementQueryString(
  from: string,
  to: string,
  storeId: string,
  productId: string,
  type: string,
  format?: "csv" | "xlsx",
) {
  const query = new URLSearchParams({ from, to, limit: "50" });
  if (storeId) {
    query.set("storeId", storeId);
  }
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

function comparisonQueryString(
  metric: ComparisonMetric,
  period: ComparisonPeriod,
  year1: number,
  year2: number,
  storeId: string,
) {
  const query = new URLSearchParams({
    metric,
    period,
    year1: String(year1),
    year2: String(year2),
  });
  if (storeId) {
    query.set("storeId", storeId);
  }
  return query.toString();
}

async function downloadReport(endpoint: string, from: string, to: string, storeId: string, format: "csv" | "xlsx") {
  await downloadApiFile(`/reports/${endpoint}/export?${dateRangeQuery(from, to, storeId, { format })}`, `${endpoint}-${from}-${to}.${format}`);
}

function money(value: number) {
  return `Rs ${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatSummaryParts(...parts: string[]): string {
  return parts.join(" · ");
}

function monthName(value: string): string {
  const month = Number(value);
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return value;
  }
  return new Date(Date.UTC(2026, month - 1, 1)).toLocaleString("en-IN", { month: "short" });
}

function formatComparisonValue(metric: ComparisonMetric, value: number): string {
  if (metric === "revenue" || metric === "expenses") {
    return money(value);
  }
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
