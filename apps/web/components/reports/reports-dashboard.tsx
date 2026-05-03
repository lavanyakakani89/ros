"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { StatStrip } from "@/components/shared/stat-strip";
import { createAuthenticatedApiClient } from "@/lib/api-client";

interface ReportSummary {
  grossSales: number;
  netSales: number;
  discountTotal: number;
  totalGst: number;
  invoiceCount: number;
  averageBillValue: number;
  dailySales: Array<{ date: string; sales: number; invoices: number }>;
  gstByRate: Array<{ gstRate: number; totalGst: number }>;
  hsnSummary: Array<{ hsnCode: string; totalSales: number }>;
  movingItems: Array<{ productName: string; quantitySold: number; totalSales: number }>;
}

interface InventoryReport {
  stockValue: number;
  lowStockCount: number;
  stockByCategory: Array<{ category: string; stock: number }>;
}

export function ReportsDashboard() {
  const summaryQuery = useQuery({
    queryKey: ["reports-summary"],
    queryFn: () => createAuthenticatedApiClient().get<ReportSummary>("/reports/summary"),
  });
  const inventoryQuery = useQuery({
    queryKey: ["reports-inventory"],
    queryFn: () => createAuthenticatedApiClient().get<InventoryReport>("/reports/inventory"),
  });

  const summary = summaryQuery.data;
  const inventory = inventoryQuery.data;
  const salesData = summary?.dailySales.map((item) => ({
    day: item.date.slice(5),
    sales: item.sales,
    invoices: item.invoices,
  })) ?? [];
  const stockData = inventory?.stockByCategory.map((item) => ({
    category: item.category,
    value: item.stock,
  })) ?? [];
  const error = summaryQuery.error ?? inventoryQuery.error;

  return (
    <div className="space-y-4">
      <StatStrip
        items={[
          { label: "Gross sales", value: money(summary?.grossSales ?? 0), tone: "emerald" },
          { label: "GST collected", value: money(summary?.totalGst ?? 0), tone: "blue" },
          { label: "Invoices", value: String(summary?.invoiceCount ?? 0), tone: "slate" },
          { label: "Avg bill", value: money(summary?.averageBillValue ?? 0), tone: "amber" },
        ]}
      />
      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-md border border-border bg-white p-4">
          <div className="mb-4 text-sm font-semibold text-slate-950">Daily sales</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={salesData}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Line type="monotone" dataKey="sales" stroke="#059669" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="invoices" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="rounded-md border border-border bg-white p-4">
          <div className="mb-4 text-sm font-semibold text-slate-950">Stock by category</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stockData}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="category" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="rounded-md border border-border bg-white p-4 xl:col-span-2">
          <div className="grid gap-4 md:grid-cols-3">
            <ReportList title="GST by rate" items={(summary?.gstByRate ?? []).map((item) => `${String(item.gstRate)}% - ${money(item.totalGst)}`)} />
            <ReportList title="HSN summary" items={(summary?.hsnSummary ?? []).slice(0, 6).map((item) => `${item.hsnCode} - ${money(item.totalSales)}`)} />
            <ReportList title="Fast-moving items" items={(summary?.movingItems ?? []).slice(0, 6).map((item) => `${item.productName} - ${String(item.quantitySold)}`)} />
          </div>
        </section>
      </div>
    </div>
  );
}

function ReportList({ title, items }: Readonly<{ title: string; items: string[] }>) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-950">{title}</div>
      <div className="space-y-2">
        {items.length > 0 ? (
          items.map((item) => <div key={item} className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{item}</div>)
        ) : (
          <div className="text-sm text-slate-500">No data yet</div>
        )}
      </div>
    </div>
  );
}

function money(value: number): string {
  return `INR ${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
