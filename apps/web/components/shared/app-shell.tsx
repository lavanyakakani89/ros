"use client";

import type { VerticalConfig, VerticalNavigationItem } from "@retailos/shared";
import { pharmacyConfig } from "@retailos/vertical-configs";
import { AlertTriangle, CreditCard, LogOut, PanelLeftClose, PanelLeftOpen, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { iconMap } from "@/components/shared/icon-map";
import { apiUrl, createAuthenticatedApiClient, getCurrentVerticalConfig, logout } from "@/lib/api-client";
import {
  clearStoredImpersonation,
  getStoredImpersonation,
  storeImpersonation,
  type StoredImpersonation,
} from "@/lib/impersonation";
import { dashboardItem, groupedNavigation } from "@/lib/navigation-groups";
import { cn } from "@/lib/utils";
import {
  getStoredAuthSession,
  getStoredTenant,
  getStoredVerticalConfig,
  storeTenant,
  storeVerticalConfig,
  type StoredAuthSession,
  type StoredTenant,
} from "@/lib/vertical-config";

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [verticalConfig, setVerticalConfig] = useState<VerticalConfig>(pharmacyConfig);
  const [tenant, setTenant] = useState<StoredTenant | null>(null);
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});
  const [online, setOnline] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [impersonation, setImpersonation] = useState<StoredImpersonation | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const storedConfig = getStoredVerticalConfig();
    const storedTenant = getStoredTenant();
    const storedSession = getStoredAuthSession();
    const storedImpersonation = getStoredImpersonation();
    const storedSidebar = window.localStorage.getItem("retailos.sidebarCollapsed");

    if (storedConfig) {
      setVerticalConfig(storedConfig);
    }

    if (storedTenant) {
      setTenant(storedTenant);
    }

    if (storedSession) {
      setSession(storedSession);
    }

    if (storedImpersonation) {
      setImpersonation(storedImpersonation);
    }

    if (storedSidebar) {
      setSidebarCollapsed(storedSidebar === "true");
    }

    async function verifySession() {
      try {
        const current = await getCurrentVerticalConfig();
        setTenant(current.tenant);
        setVerticalConfig(current.config);
        storeTenant(current.tenant);
        storeVerticalConfig(current.config);
        setImpersonation(current.impersonation ?? null);
        storeImpersonation(current.impersonation ?? null);
        setCheckingSession(false);
      } catch {
        router.replace("/login");
      }
    }

    if (typeof navigator !== "undefined") {
      setOnline(navigator.onLine);
    }

    function handleOnlineState() {
      setOnline(navigator.onLine);
    }

    window.addEventListener("online", handleOnlineState);
    window.addEventListener("offline", handleOnlineState);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);

    async function fetchBadges() {
      try {
        const api = createAuthenticatedApiClient();
        const [inventory, deliveries, invoices] = await Promise.all([
          api.get<{ lowStockCount: number }>("/reports/inventory"),
          api.get<Array<{ status: string }>>("/delivery"),
          api.get<{ data: Array<{ amountDue?: string | number; status?: string }> }>("/billing/invoices?limit=100"),
        ]);
        const deliveryCount = deliveries.filter((delivery) => ["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY"].includes(delivery.status)).length;
        const outstandingCount = invoices.data.filter((invoice) => Number(invoice.amountDue ?? 0) > 0 || invoice.status === "PARTIAL").length;
        setBadgeCounts({
          "/inventory": inventory.lowStockCount,
          "/delivery": deliveryCount,
          "/payments": outstandingCount,
        });
      } catch {
        // non-critical
      }
    }

    void verifySession();
    void fetchBadges();

    return () => {
      window.removeEventListener("online", handleOnlineState);
      window.removeEventListener("offline", handleOnlineState);
      window.clearInterval(timer);
    };
  }, [router]);

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-sm font-medium text-slate-600">
        Loading RetailOS
      </div>
    );
  }

  const tenantName = tenant?.name ?? "RetailOS";
  const userName = impersonation?.superAdminName ?? session?.user?.name ?? "Owner";
  const initials = getInitials(userName);
  const dashboard = dashboardItem(verticalConfig.navigation);
  const navGroups = groupedNavigation(verticalConfig.navigation);
  const sidebarWidthClass = sidebarCollapsed ? "lg:pl-20" : "lg:pl-64";

  function toggleSidebar() {
    setSidebarCollapsed((value) => {
      window.localStorage.setItem("retailos.sidebarCollapsed", String(!value));
      return !value;
    });
  }

  async function handleLogout() {
    if (impersonation) {
      await handleEndImpersonation();
      return;
    }

    await logout();
    router.replace("/login");
  }

  async function handleEndImpersonation() {
    await fetch(apiUrl("/superadmin/impersonate/end"), {
      method: "POST",
      credentials: "include",
    }).catch(() => null);
    clearStoredImpersonation();
    setImpersonation(null);
    router.replace("/superadmin/dashboard");
  }

  return (
    <div className="min-h-screen bg-surface text-ink">
      <aside className={cn("fixed inset-y-0 left-0 hidden border-r border-border bg-white transition-[width] duration-200 lg:block", sidebarCollapsed ? "w-20" : "w-64")}>
        <div className={cn("flex h-16 items-center gap-3 border-b border-border px-4", sidebarCollapsed && "justify-center px-3")}>
          <div className="flex size-9 items-center justify-center rounded-md bg-emerald-600 text-white">
            <CreditCard className="size-5" aria-hidden="true" />
          </div>
          <div className={cn(sidebarCollapsed && "sr-only")}>
            <div className="text-sm font-semibold">RetailOS</div>
            <div className="text-xs text-slate-500">{tenantName}</div>
            <div className="text-[10px] text-slate-400">{verticalConfig.displayName} | {tenant?.gstEnabled === false ? "GST off" : "GST enabled"}</div>
          </div>
        </div>
        <nav className={cn("px-3 py-4", sidebarCollapsed && "px-2")} aria-label="Main navigation">
          {dashboard ? (
            <NavigationLink item={dashboard} pathname={pathname} badgeCount={badgeCounts[dashboard.href] ?? 0} collapsed={sidebarCollapsed} />
          ) : null}
          {navGroups.map((group) => (
            <div key={group.label} className="mt-4 border-t border-border pt-3">
              <div className={cn("px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400", sidebarCollapsed && "sr-only")}>{group.label}</div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavigationLink key={item.href} item={item} pathname={pathname} badgeCount={badgeCounts[item.href] ?? 0} collapsed={sidebarCollapsed} />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className={cn("transition-[padding] duration-200", sidebarWidthClass)}>
        <header className="sticky top-0 z-10 border-b border-border bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center justify-between px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                className="hidden size-9 items-center justify-center rounded-md border border-border text-slate-600 hover:bg-slate-50 lg:inline-flex"
                onClick={toggleSidebar}
                title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
              </button>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{tenantName}</div>
                <div className="truncate text-xs text-slate-500">{verticalConfig.displayName} | {tenant?.gstEnabled === false ? "GST off" : "GST enabled"} | ₹</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="hidden size-2.5 rounded-full sm:block"
                title={online ? "Online" : "Offline"}
                aria-label={online ? "Online" : "Offline"}
                role="status"
              >
                <span className={cn("block size-2.5 rounded-full", online ? "bg-emerald-500" : "bg-red-500")} />
              </div>
              <div className="flex size-9 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">{initials}</div>
              <button
                className="inline-flex size-9 items-center justify-center rounded-md border border-border text-slate-600 hover:bg-slate-50"
                onClick={() => void handleLogout()}
                title={impersonation ? "Exit support view" : "Logout"}
                aria-label={impersonation ? "Exit support view" : "Logout"}
              >
                <LogOut className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <nav className="flex gap-2 overflow-x-auto border-t border-border px-2 py-2 lg:hidden" aria-label="Main navigation">
            {dashboard ? (
              <NavigationLink item={dashboard} pathname={pathname} badgeCount={badgeCounts[dashboard.href] ?? 0} mobile />
            ) : null}
            {navGroups.map((group) => (
              <div key={group.label} className="flex shrink-0 items-stretch gap-1 rounded-md border border-border bg-slate-50 p-1">
                <div className="flex w-14 items-center justify-center px-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <NavigationLink key={item.href} item={item} pathname={pathname} badgeCount={badgeCounts[item.href] ?? 0} mobile />
                ))}
              </div>
            ))}
          </nav>
        </header>
        {tenant?.status === "WARNING" ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:px-6">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Your RetailOS subscription needs attention. Billing continues to work, but please contact your administrator.</span>
            </div>
          </div>
        ) : null}
        {impersonation ? (
          <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="font-semibold">
                    Support impersonation: {impersonation.superAdminEmail} is viewing {tenantName}
                  </div>
                  <div className="text-xs text-amber-800">
                    {impersonation.accessLevel === "READ_ONLY" ? "Read-only mode" : "Write mode"} | expires in {formatTimeLeft(impersonation.expiresAt, now)}
                  </div>
                </div>
              </div>
              <button
                className="h-8 rounded-md border border-amber-500 bg-white px-3 text-xs font-semibold text-amber-950 hover:bg-amber-100"
                onClick={() => void handleEndImpersonation()}
              >
                Exit support view
              </button>
            </div>
          </div>
        ) : null}
        <main className="px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

function formatTimeLeft(expiresAt: string, now: number): string {
  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - now);
  const minutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  if (hours <= 0) {
    return `${String(restMinutes)}m`;
  }

  return `${String(hours)}h ${String(restMinutes)}m`;
}

function getInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "RO"
  );
}

function getNavigationIcon(item: VerticalNavigationItem) {
  if (item.icon in iconMap) {
    return iconMap[item.icon as keyof typeof iconMap];
  }

  return CreditCard;
}

function NavigationLink({
  item,
  pathname,
  badgeCount,
  collapsed = false,
  mobile = false,
}: Readonly<{
  item: VerticalNavigationItem;
  pathname: string;
  badgeCount: number;
  collapsed?: boolean;
  mobile?: boolean;
}>) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = getNavigationIcon(item);
  const iconClass = navigationIconClass(item.href);

  if (mobile) {
    return (
      <Link
        href={item.href}
        className={cn(
          "relative flex min-w-20 flex-col items-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-slate-600",
          active && "bg-emerald-50 text-emerald-700",
        )}
      >
        <div className={cn("relative flex size-8 items-center justify-center rounded-md bg-white", active && "bg-emerald-100")}>
          <Icon className={cn("size-4", iconClass)} aria-hidden="true" />
          {badgeCount > 0 ? (
            <span className="absolute -right-2 -top-1.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
              {badgeCount > 9 ? "9+" : badgeCount}
            </span>
          ) : null}
        </div>
        <span className="whitespace-nowrap">{item.label}</span>
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      className={cn(
        "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-50",
        collapsed && "relative justify-center px-2",
        active && "bg-emerald-50 text-emerald-700",
      )}
      title={collapsed ? item.label : undefined}
    >
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-50", active && "bg-white")}>
        <Icon className={cn("size-4", iconClass)} aria-hidden="true" />
      </span>
      <span className={cn("flex-1 truncate", collapsed && "sr-only")}>{item.label}</span>
      {badgeCount > 0 ? (
        <span className={cn("flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white", collapsed && "absolute ml-7 mt-[-22px] size-4 text-[9px]")}>
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      ) : null}
    </Link>
  );
}

function navigationIconClass(href: string): string {
  if (["/billing", "/quotations", "/coupons", "/loyalty", "/credit-notes"].includes(href)) {
    return "text-emerald-600";
  }

  if (["/inventory", "/inventory/expiry", "/inventory/warranty", "/categories", "/purchases", "/purchase-returns", "/delivery"].includes(href)) {
    return "text-blue-600";
  }

  if (["/customers", "/suppliers"].includes(href)) {
    return "text-violet-600";
  }

  if (["/payments", "/expenses"].includes(href)) {
    return "text-amber-600";
  }

  if (["/reports", "/audit", "/settings"].includes(href)) {
    return "text-slate-600";
  }

  if (href === "/restaurant") {
    return "text-rose-600";
  }

  return "text-emerald-600";
}
