"use client";

import type { VerticalConfig, VerticalNavigationItem } from "@retailos/shared";
import { pharmacyConfig } from "@retailos/vertical-configs";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  Bell,
  Clock3,
  Eye,
  EyeOff,
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
import { getPendingInvoiceCounts } from "@/lib/offline-queue";
import { getStoredAuthSession, getStoredTenant, getStoredVerticalConfig, type StoredTenant } from "@/lib/vertical-config";
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

interface DeliveryRecord {
  id: string;
  status: "PENDING" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "CANCELLED";
  customer?: {
    name?: string;
  };
}

interface SparklineResponse {
  data: Array<{ date: string; value: number }>;
}

interface OutstandingSummary {
  totalOutstanding: number;
  customerCount: number;
  oldest30Days: number;
  oldest60Days: number;
  oldest90Plus: number;
}

interface ExpiringBatch {
  id: string;
  expiryDate?: string | null;
  product?: {
    name?: string;
  } | null;
}

interface AuditLogRecord {
  id: string;
  action: string;
  entity: string;
  createdAt: string;
  user?: {
    name?: string;
  } | null;
}

type DashboardRole = "OWNER" | "MANAGER" | "STAFF" | "DELIVERY";

const quickActions = [
  { href: "/billing", label: "New invoice", icon: Plus, primary: true },
  { href: "/purchases", label: "Receive stock", icon: ArrowDownToLine, primary: false },
  { href: "/payments", label: "Record payment", icon: IndianRupee, primary: false },
  { href: "/customers", label: "Add customer", icon: UserPlus, primary: false },
] as const;

export function DashboardHome() {
  const [verticalConfig, setVerticalConfig] = useState<VerticalConfig>(pharmacyConfig);
  const [tenant, setTenant] = useState<StoredTenant | null>(null);
  const [role, setRole] = useState<DashboardRole>("OWNER");
  const [offlineInvoices, setOfflineInvoices] = useState({ pending: 0, syncing: 0, failed: 0 });
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  useEffect(() => {
    setVerticalConfig(getStoredVerticalConfig() ?? pharmacyConfig);
    setTenant(getStoredTenant());
    setRole(getStoredAuthSession()?.user?.role ?? "OWNER");
    getPendingInvoiceCounts()
      .then(setOfflineInvoices)
      .catch(() => setOfflineInvoices({ pending: 0, syncing: 0, failed: 0 }));
  }, []);

  const canSeeOwnerWidgets = role === "OWNER" || role === "MANAGER";
  const isDeliveryRole = role === "DELIVERY";
  const showExpiryWidget = !isDeliveryRole && (verticalConfig.vertical === "PHARMACY" || verticalConfig.vertical === "GROCERY");

  const todaySalesQuery = useQuery({
    queryKey: ["dashboard-sales-today", today],
    queryFn: () =>
      createAuthenticatedApiClient().get<SalesSummary>(`/reports/summary?from=${today}&to=${today}`),
    enabled: !isDeliveryRole,
  });
  const weekSalesQuery = useQuery({
    queryKey: ["dashboard-sales-week", weekAgo, today],
    queryFn: () =>
      createAuthenticatedApiClient().get<SalesSummary>(`/reports/summary?from=${weekAgo}&to=${today}`),
    enabled: !isDeliveryRole,
  });
  const inventoryQuery = useQuery({
    queryKey: ["dashboard-inventory"],
    queryFn: () => createAuthenticatedApiClient().get<InventorySummary>("/reports/inventory"),
    enabled: !isDeliveryRole,
  });
  const pnlQuery = useQuery({
    queryKey: ["dashboard-pnl"],
    queryFn: () =>
      createAuthenticatedApiClient().get<PnlSummary>(`/reports/pnl?from=${weekAgo}&to=${today}`),
    enabled: canSeeOwnerWidgets,
  });
  const deliveriesQuery = useQuery({
    queryKey: ["dashboard-deliveries"],
    queryFn: () => createAuthenticatedApiClient().get<DeliveryRecord[]>("/delivery?scope=active"),
  });
  const auditQuery = useQuery({
    queryKey: ["dashboard-audit"],
    queryFn: () => createAuthenticatedApiClient().get<{ data: AuditLogRecord[] }>("/audit-logs?limit=8"),
    enabled: canSeeOwnerWidgets,
  });
  const revenueSparklineQuery = useQuery({
    queryKey: ["dashboard-sparkline", "revenue", 14],
    queryFn: () => createAuthenticatedApiClient().get<SparklineResponse>("/reports/sparkline?metric=revenue&days=14"),
    enabled: !isDeliveryRole,
  });
  const invoicesSparklineQuery = useQuery({
    queryKey: ["dashboard-sparkline", "invoices", 14],
    queryFn: () => createAuthenticatedApiClient().get<SparklineResponse>("/reports/sparkline?metric=invoices&days=14"),
    enabled: !isDeliveryRole,
  });
  const outstandingSummaryQuery = useQuery({
    queryKey: ["dashboard-outstanding-summary"],
    queryFn: () => createAuthenticatedApiClient().get<OutstandingSummary>("/reports/outstanding-summary"),
    enabled: canSeeOwnerWidgets,
  });
  const expiringQuery = useQuery({
    queryKey: ["dashboard-expiring-products"],
    queryFn: () => createAuthenticatedApiClient().get<ExpiringBatch[]>("/inventory/products/expiring?days=30"),
    enabled: showExpiryWidget,
  });

  const todaySales = todaySalesQuery.data;
  const s = weekSalesQuery.data;
  const inv = inventoryQuery.data;
  const pnl = pnlQuery.data;
  const outstandingSummary = outstandingSummaryQuery.data;
  const expiringBatches = expiringQuery.data ?? [];
  const revenueSparkline = revenueSparklineQuery.data?.data ?? [];
  const invoicesSparkline = invoicesSparklineQuery.data?.data ?? [];
  const deliveries = deliveriesQuery.data ?? [];
  const pendingDeliveryCount = deliveries.filter((delivery) => ["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY"].includes(delivery.status)).length;
  const failedDeliveryCount = deliveries.filter((delivery) => delivery.status === "FAILED").length;
  const auditLogs = auditQuery.data?.data ?? [];
  const tenantName = tenant?.name ?? "RetailOS";
  const moduleGroups = dashboardModuleGroups(verticalConfig.navigation);
  const maxSales = Math.max(...(s?.dailySales ?? []).map((day) => day.sales), 1);
  const revenueTrend = trendPercent(revenueSparkline);
  const invoicesTrend = trendPercent(invoicesSparkline);

  const kpis = [
    { label: "Today's sales", value: money(todaySales?.netSales ?? 0), change: `${String(todaySales?.invoiceCount ?? 0)} bills today`, icon: IndianRupee, tone: "emerald", private: true, roles: ["OWNER", "MANAGER", "STAFF"], sparkline: revenueSparkline, trendPct: revenueTrend },
    { label: "Today's invoices", value: String(todaySales?.invoiceCount ?? 0), change: "Bills created today", icon: Receipt, tone: "blue", roles: ["STAFF"], sparkline: invoicesSparkline, trendPct: invoicesTrend },
    { label: "7-day sales", value: money(s?.netSales ?? 0), change: `${String(s?.invoiceCount ?? 0)} bills in range`, icon: Receipt, tone: "blue", private: true, roles: ["OWNER", "MANAGER"], sparkline: revenueSparkline, trendPct: revenueTrend },
    { label: "Outstanding dues", value: money(outstandingSummary?.totalOutstanding ?? s?.due ?? 0), change: `${String(outstandingSummary?.customerCount ?? 0)} customers`, icon: AlertTriangle, tone: "amber", roles: ["OWNER", "MANAGER"] },
    { label: "Low stock items", value: String(inv?.lowStockCount ?? 0), change: "Needs reorder", icon: Package, tone: "red", roles: ["OWNER", "MANAGER"] },
    { label: "Open deliveries", value: String(pendingDeliveryCount), change: failedDeliveryCount > 0 ? `${String(failedDeliveryCount)} failed` : "Pending or assigned", icon: Clock3, tone: "blue", roles: ["OWNER", "MANAGER", "STAFF", "DELIVERY"] },
    { label: "Offline invoices", value: String(offlineInvoices.pending + offlineInvoices.syncing + offlineInvoices.failed), change: offlineInvoices.failed > 0 ? `${String(offlineInvoices.failed)} failed sync` : "Queued locally", icon: Bell, tone: offlineInvoices.failed > 0 ? "red" : "slate", roles: ["OWNER", "MANAGER", "STAFF"] },
    { label: "Gross profit", value: money(pnl?.grossProfit ?? 0), change: `${pnl ? pnl.grossMarginPct.toFixed(1) : "0.0"}% margin`, icon: TrendingUp, tone: "violet", private: true, roles: ["OWNER", "MANAGER"] },
    { label: "Stock value", value: money(inv?.stockValue ?? 0), change: "Inventory holding", icon: Package, tone: "slate", private: true, roles: ["OWNER", "MANAGER"] },
  ] as const;
  const visibleKpis = kpis.filter((kpi) => kpi.roles.some((allowedRole) => allowedRole === role));
  const greeting = greetingForNow();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-950">{greeting}, {tenantName}</h1>
        <p className="text-sm text-slate-500">{formatToday()} | {verticalConfig.displayName}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {visibleKpis.map((kpi) => (
          <KpiCard key={kpi.label} item={kpi} />
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {!isDeliveryRole ? (
          <AlertBlock
            tone="amber"
            icon={AlertTriangle}
            title={`${String(inv?.lowStockCount ?? 0)} low stock items`}
            detail="Review stock before billing pressure builds up."
            href="/inventory"
          />
        ) : null}
        {canSeeOwnerWidgets ? <OutstandingReceivablesCard summary={outstandingSummary} /> : null}
        {showExpiryWidget ? (
          <AlertBlock
            tone="amber"
            icon={Clock3}
            title={`${String(expiringBatches.length)} batches expiring within 30 days`}
            detail={expiringBatches[0]?.product?.name ? `Next: ${expiringBatches[0].product.name}` : "Review upcoming expirations."}
            href="/inventory"
          />
        ) : null}
        {pendingDeliveryCount > 0 ? (
          <AlertBlock
            tone="blue"
            icon={Clock3}
            title={`${String(pendingDeliveryCount)} deliveries need action`}
            detail="Assign riders or update delivery status from the delivery board."
            href="/delivery"
          />
        ) : null}
      </div>

      {!isDeliveryRole ? (
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
      ) : null}

      {!isDeliveryRole ? (
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
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-md border border-border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-950">Open deliveries</div>
            <Link href="/delivery" className="text-xs font-medium text-emerald-700 hover:underline">Open board</Link>
          </div>
          {deliveries.length === 0 ? (
            <p className="text-sm text-slate-400">No delivery orders yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {deliveries.slice(0, 8).map((delivery) => (
                <div key={delivery.id} className="flex items-center justify-between py-2">
                  <span className="truncate text-sm text-slate-700">{delivery.customer?.name ?? "Walk-in customer"}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", deliveryStatusClass(delivery.status))}>
                    {delivery.status.replaceAll("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {canSeeOwnerWidgets ? (
        <div className="rounded-md border border-border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-950">Recent activity</div>
            <Link href="/audit" className="text-xs font-medium text-emerald-700 hover:underline">View audit</Link>
          </div>
          {auditLogs.length === 0 ? (
            <p className="text-sm text-slate-400">No audit activity yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {auditLogs.map((log) => (
                <div key={log.id} className="py-2">
                  <div className="text-sm font-medium text-slate-800">{readableAction(log.action)} {log.entity.toLowerCase()}</div>
                  <div className="text-xs text-slate-400">{log.user?.name ?? "System"} | {formatDateTime(log.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        ) : null}
      </div>

      {!isDeliveryRole ? moduleGroups.map((group) => (
        <section key={group.label} className="rounded-md border border-border bg-white p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{group.label}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {group.items.map((item) => (
              <ModuleTile key={item.href} item={item} />
            ))}
          </div>
        </section>
      )) : null}
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
    private?: boolean;
    sparkline?: Array<{ date: string; value: number }>;
    trendPct?: number | null;
  };
}>) {
  const [revealed, setRevealed] = useState(!item.private);
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
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-xs text-slate-500">{item.label}</div>
            {item.private ? (
              <button
                type="button"
                aria-label={revealed ? `Hide ${item.label}` : `Show ${item.label}`}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setRevealed((value) => !value)}
              >
                {revealed ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            ) : null}
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-950">{revealed ? item.value : "••••"}</div>
          <div className="text-xs text-slate-400">{revealed ? item.change : "Hidden"}</div>
          {item.sparkline && item.sparkline.length > 1 ? (
            <div className="mt-2 flex items-center gap-2">
              <Sparkline data={item.sparkline} />
              {item.trendPct !== null && item.trendPct !== undefined ? (
                <span className={cn("text-[11px] font-semibold", item.trendPct >= 0 ? "text-emerald-700" : "text-red-700")}>
                  {item.trendPct >= 0 ? "+" : "-"}{Math.abs(item.trendPct).toFixed(1)}%
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data }: Readonly<{ data: Array<{ date: string; value: number }> }>) {
  const max = Math.max(...data.map((point) => point.value), 1);
  const width = 92;
  const height = 24;
  const lastIndex = Math.max(data.length - 1, 1);
  const points = data
    .map((point, index) => {
      const x = (index / lastIndex) * width;
      const y = height - (point.value / max) * (height - 3) - 1.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="h-6 w-24 text-emerald-500" viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label="Trend">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OutstandingReceivablesCard({ summary }: Readonly<{ summary: OutstandingSummary | undefined }>) {
  return (
    <Link href="/customers" className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <div className="font-medium">{money(summary?.totalOutstanding ?? 0)} receivables</div>
          <div className="text-xs opacity-80">{String(summary?.customerCount ?? 0)} customers with dues</div>
          <div className="mt-2 text-[11px] opacity-75">30+ {money(summary?.oldest30Days ?? 0)} | 60+ {money(summary?.oldest60Days ?? 0)} | 90+ {money(summary?.oldest90Plus ?? 0)}</div>
        </div>
      </div>
    </Link>
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
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function trendPercent(data: Array<{ value: number }>): number | null {
  if (data.length < 4) {
    return null;
  }

  const midpoint = Math.floor(data.length / 2);
  const previous = data.slice(0, midpoint).reduce((sum, point) => sum + point.value, 0);
  const current = data.slice(midpoint).reduce((sum, point) => sum + point.value, 0);
  if (previous === 0) {
    return current > 0 ? 100 : null;
  }

  return ((current - previous) / previous) * 100;
}

function deliveryStatusClass(status: DeliveryRecord["status"]): string {
  if (status === "DELIVERED") {
    return "bg-emerald-50 text-emerald-700";
  }

  if (status === "FAILED" || status === "CANCELLED") {
    return "bg-red-50 text-red-700";
  }

  if (status === "OUT_FOR_DELIVERY") {
    return "bg-blue-50 text-blue-700";
  }

  return "bg-amber-50 text-amber-700";
}

function readableAction(action: string): string {
  return action.replaceAll("_", " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatToday(): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

function greetingForNow(): string {
  const hour = Number(new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(new Date()));

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 17) {
    return "Good afternoon";
  }

  return "Good evening";
}
