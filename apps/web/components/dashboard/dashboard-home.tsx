"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUp, IndianRupee, Package, Receipt, TrendingUp } from "lucide-react";
import Link from "next/link";

import { createAuthenticatedApiClient } from "@/lib/api-client";

interface SalesSummary {
  grossSales: number;
  netSales: number;
  invoiceCount: number;
  averageBillValue: number;
  totalGst: number;
  paid: number;
  due: number;
  movingItems: Array<{ productName: string; quantitySold: number; totalSales: number }>;
  dailySales: Array<{ date: string; sales: number; invoices: number }>;
}

interface InventorySummary {
  stockValue: number;
  lowStockCount: number;
}

interface PnlSummary {
  revenue: number;
  cost: number;
  grossProfit: number;
  grossMarginPct: number;
}

export function DashboardHome() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  const salesQuery = useQuery({
    queryKey: ["dashboard-sales"],
    queryFn: () =>
      createAuthenticatedApiClient().get<SalesSummary>(`/reports/summary?from=${weekAgo}&to=${today}`),
  });
  const inventoryQuery = useQuery({
    queryKey: ["dashboard-inventory"],
    queryFn: () => createAuthenticatedApiClient().get<InventorySummary>("/reports/inventory"),
  });
  const pnlQuery = useQuery({
    queryKey: ["dashboard-pnl"],
    queryFn: () =>
      createAuthenticatedApiClient().get<PnlSummary>(`/reports/pnl?from=${weekAgo}&to=${today}`),
  });

  const s = salesQuery.data;
  const inv = inventoryQuery.data;
  const pnl = pnlQuery.data;

  const kpis = [
    { label: "Net Sales (7d)", value: money(s?.netSales ?? 0), icon: IndianRupee, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Invoices (7d)", value: String(s?.invoiceCount ?? 0), icon: Receipt, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Outstanding Due", value: money(s?.due ?? 0), icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "Gross Profit (7d)", value: `${pnl ? pnl.grossMarginPct.toFixed(1) : "—"}%`, icon: TrendingUp, color: "text-violet-600", bg: "bg-violet-50" },
    { label: "Stock Value", value: money(inv?.stockValue ?? 0), icon: Package, color: "text-slate-600", bg: "bg-slate-50" },
    { label: "Low Stock Items", value: String(inv?.lowStockCount ?? 0), icon: ArrowUp, color: "text-red-600", bg: "bg-red-50" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-950">Dashboard</h1>
        <p className="text-sm text-slate-500">Overview for the last 7 days</p>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-md border border-border bg-white p-5">
            <div className="flex items-center gap-3">
              <div className={`flex size-10 items-center justify-center rounded-md ${kpi.bg}`}>
                <kpi.icon className={`size-5 ${kpi.color}`} aria-hidden="true" />
              </div>
              <div>
                <div className="text-xs text-slate-500">{kpi.label}</div>
                <div className="text-xl font-bold text-slate-950">{kpi.value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Top-selling items */}
        <div className="rounded-md border border-border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-950">Top-selling items (7d)</div>
            <Link href="/reports" className="text-xs text-emerald-700 hover:underline">View all</Link>
          </div>
          {(s?.movingItems ?? []).slice(0, 8).length === 0 ? (
            <p className="text-sm text-slate-400">No sales data yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {(s?.movingItems ?? []).slice(0, 8).map((item) => (
                <div key={item.productName} className="flex items-center justify-between py-2">
                  <span className="text-sm text-slate-700">{item.productName}</span>
                  <div className="text-right">
                    <div className="text-sm font-medium">{money(item.totalSales)}</div>
                    <div className="text-xs text-slate-400">{item.quantitySold} units</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Daily sales mini-chart (text) */}
        <div className="rounded-md border border-border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-950">Daily sales (7d)</div>
            <Link href="/billing" className="text-xs text-emerald-700 hover:underline">New invoice</Link>
          </div>
          {(s?.dailySales ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">No sales data yet.</p>
          ) : (
            <div className="space-y-2">
              {(s?.dailySales ?? []).map((day) => {
                const maxSales = Math.max(...(s?.dailySales ?? []).map((d) => d.sales), 1);
                const pct = (day.sales / maxSales) * 100;
                return (
                  <div key={day.date} className="flex items-center gap-3">
                    <span className="w-16 text-xs text-slate-500">{day.date.slice(5)}</span>
                    <div className="flex-1 rounded-full bg-slate-100 h-2">
                      <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${String(pct)}%` }} />
                    </div>
                    <span className="w-24 text-right text-xs font-medium text-slate-700">{money(day.sales)}</span>
                    <span className="w-12 text-right text-xs text-slate-400">{day.invoices} inv</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Quick actions</div>
        <div className="flex flex-wrap gap-3">
          {[
            { href: "/billing", label: "New Invoice" },
            { href: "/inventory", label: "Add Product" },
            { href: "/purchases", label: "New Purchase Order" },
            { href: "/customers", label: "Add Customer" },
            { href: "/reports", label: "View Reports" },
            { href: "/reports?tab=gstr", label: "GSTR Export" },
          ].map((link) => (
            <Link key={link.href} href={link.href} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function money(v: number) {
  return `INR ${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
