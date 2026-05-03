"use client";

import type { VerticalConfig, VerticalNavigationItem } from "@retailos/shared";
import { pharmacyConfig } from "@retailos/vertical-configs";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  Bell,
  IndianRupee,
  Package,
  Plus,
  Receipt,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import type { ElementType } from "react";
import { useEffect, useState } from "react";

import { iconMap } from "@/components/shared/icon-map";
import { createAuthenticatedApiClient } from "@/lib/api-client";
import { dashboardModuleGroups } from "@/lib/navigation-groups";
import { getStoredTenant, getStoredVerticalConfig, type StoredTenant } from "@/lib/vertical-config";
import { cn } from "@/lib/utils";

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

const quickActions = [
  { href: "/billing", label: "New invoice", icon: Plus, primary: true },
  { href: "/purchases", label: "Receive stock", icon: ArrowDownToLine, primary: false },
  { href: "/payments", label: "Record payment", icon: IndianRupee, primary: false },
  { href: "/customers", label: "Add customer", icon: UserPlus, primary: false },
] as const;

export function DashboardHome() {
  const [verticalConfig, setVerticalConfig] = useState<VerticalConfig>(pharmacyConfig);
  const [tenant, setTenant] = useState<StoredTenant | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  useEffect(() => {
    setVerticalConfig(getStoredVerticalConfig() ?? pharmacyConfig);
    setTenant(getStoredTenant());
  }, []);

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
  const tenantName = tenant?.name ?? "RetailOS";
  const moduleGroups = dashboardModuleGroups(verticalConfig.navigation);
  const maxSales = Math.max(...(s?.dailySales ?? []).map((day) => day.sales), 1);

  const kpis = [
    { label: "Today's sales", value: money(s?.netSales ?? 0), change: "Last 7 days net", icon: IndianRupee, tone: "emerald" },
    { label: "Invoices", value: String(s?.invoiceCount ?? 0), change: "Bills in range", icon: Receipt, tone: "blue" },
    { label: "Outstanding dues", value: money(s?.due ?? 0), change: "Customer credit", icon: AlertTriangle, tone: "amber" },
    { label: "Low stock items", value: String(inv?.lowStockCount ?? 0), change: "Needs reorder", icon: Package, tone: "red" },
    { label: "Gross profit", value: money(pnl?.grossProfit ?? 0), change: `${pnl ? pnl.grossMarginPct.toFixed(1) : "0.0"}% margin`, icon: TrendingUp, tone: "violet" },
    { label: "Stock value", value: money(inv?.stockValue ?? 0), change: "Inventory holding", icon: Package, tone: "slate" },
  ] as const;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-950">Good morning, {tenantName}</h1>
        <p className="text-sm text-slate-500">{formatToday()} | {verticalConfig.displayName}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} item={kpi} />
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <AlertBlock
          tone="amber"
          icon={AlertTriangle}
          title={`${String(inv?.lowStockCount ?? 0)} low stock items`}
          detail="Review stock before billing pressure builds up."
          href="/inventory"
        />
        <AlertBlock
          tone="blue"
          icon={Bell}
          title={`${money(s?.due ?? 0)} outstanding`}
          detail="Follow up customer dues and record collections."
          href="/payments"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={cn(
              "flex h-12 items-center justify-between rounded-md border border-border bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50",
              action.primary && "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100",
            )}
          >
            <span className="flex items-center gap-2">
              <action.icon className="size-4" aria-hidden="true" />
              {action.label}
            </span>
            <ArrowRight className="size-4 text-slate-400" aria-hidden="true" />
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-md border border-border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-950">Daily sales</div>
            <Link href="/reports" className="text-xs font-medium text-emerald-700 hover:underline">View report</Link>
          </div>
          {(s?.dailySales ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">No sales data yet.</p>
          ) : (
            <div className="space-y-2">
              {(s?.dailySales ?? []).map((day) => {
                const pct = (day.sales / maxSales) * 100;
                return (
                  <div key={day.date} className="grid grid-cols-[52px_1fr_92px_44px] items-center gap-3">
                    <span className="text-xs text-slate-500">{day.date.slice(5)}</span>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${String(pct)}%` }} />
                    </div>
                    <span className="text-right text-xs font-medium text-slate-700">{money(day.sales)}</span>
                    <span className="text-right text-xs text-slate-400">{day.invoices}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-md border border-border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-950">Fast-moving items</div>
            <Link href="/reports" className="text-xs font-medium text-emerald-700 hover:underline">Open insights</Link>
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
      </div>

      {moduleGroups.map((group) => (
        <section key={group.label} className="rounded-md border border-border bg-white p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{group.label}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {group.items.map((item) => (
              <ModuleTile key={item.href} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function KpiCard({
  item,
}: Readonly<{
  item: {
    label: string;
    value: string;
    change: string;
    icon: ElementType;
    tone: "amber" | "blue" | "emerald" | "red" | "slate" | "violet";
  };
}>) {
  const toneClass = {
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-slate-50 text-slate-700",
    violet: "bg-violet-50 text-violet-700",
  }[item.tone];

  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="flex items-center gap-3">
        <div className={`flex size-10 items-center justify-center rounded-md ${toneClass}`}>
          <item.icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs text-slate-500">{item.label}</div>
          <div className="mt-1 text-lg font-semibold text-slate-950">{item.value}</div>
          <div className="text-xs text-slate-400">{item.change}</div>
        </div>
      </div>
    </div>
  );
}

function AlertBlock({
  icon: Icon,
  title,
  detail,
  href,
  tone,
}: Readonly<{
  icon: ElementType;
  title: string;
  detail: string;
  href: string;
  tone: "amber" | "blue";
}>) {
  const toneClass = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-900";

  return (
    <Link href={href} className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${toneClass}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="text-xs opacity-80">{detail}</span>
      </span>
    </Link>
  );
}

function ModuleTile({ item }: Readonly<{ item: VerticalNavigationItem }>) {
  const Icon = item.icon in iconMap ? iconMap[item.icon as keyof typeof iconMap] : Receipt;
  const highlight = item.href === "/billing";
  const color = moduleColor(item.href);

  return (
    <Link
      href={item.href}
      className={cn(
        "flex min-h-24 flex-col items-center justify-center gap-2 rounded-md border border-border bg-white px-3 py-4 text-center text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50",
        highlight && "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50",
      )}
    >
      <span className={cn("flex size-10 items-center justify-center rounded-md", color.bg)}>
        <Icon className={cn("size-5", color.icon)} aria-hidden="true" />
      </span>
      <span>{item.label}</span>
    </Link>
  );
}

function moduleColor(href: string): { bg: string; icon: string } {
  if (["/billing", "/quotations", "/coupons", "/loyalty", "/credit-notes"].includes(href)) {
    return { bg: "bg-emerald-50", icon: "text-emerald-600" };
  }

  if (["/inventory", "/inventory/expiry", "/inventory/warranty", "/categories", "/purchases", "/purchase-returns", "/delivery"].includes(href)) {
    return { bg: "bg-blue-50", icon: "text-blue-600" };
  }

  if (["/customers", "/suppliers"].includes(href)) {
    return { bg: "bg-violet-50", icon: "text-violet-600" };
  }

  if (["/payments", "/expenses"].includes(href)) {
    return { bg: "bg-amber-50", icon: "text-amber-600" };
  }

  if (["/reports", "/audit", "/settings"].includes(href)) {
    return { bg: "bg-slate-100", icon: "text-slate-600" };
  }

  if (href === "/restaurant") {
    return { bg: "bg-rose-50", icon: "text-rose-600" };
  }

  return { bg: "bg-emerald-50", icon: "text-emerald-600" };
}

function money(value: number) {
  return `INR ${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatToday(): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());
}
