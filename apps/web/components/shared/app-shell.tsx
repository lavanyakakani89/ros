"use client";

import type { VerticalConfig, VerticalNavigationItem } from "@retailos/shared";
import { pharmacyConfig } from "@retailos/vertical-configs";
import { AlertTriangle, CreditCard } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { iconMap } from "@/components/shared/icon-map";
import { createAuthenticatedApiClient, getCurrentVerticalConfig } from "@/lib/api-client";
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
  const [lowStockCount, setLowStockCount] = useState(0);

  useEffect(() => {
    const storedConfig = getStoredVerticalConfig();
    const storedTenant = getStoredTenant();
    const storedSession = getStoredAuthSession();

    if (storedConfig) {
      setVerticalConfig(storedConfig);
    }

    if (storedTenant) {
      setTenant(storedTenant);
    }

    if (storedSession) {
      setSession(storedSession);
    }

    async function verifySession() {
      try {
        const current = await getCurrentVerticalConfig();
        setTenant(current.tenant);
        setVerticalConfig(current.config);
        storeTenant(current.tenant);
        storeVerticalConfig(current.config);
        setCheckingSession(false);
      } catch {
        router.replace("/login");
      }
    }

    async function fetchLowStock() {
      try {
        const data = await createAuthenticatedApiClient().get<{ lowStockCount: number }>("/reports/inventory");
        setLowStockCount(data.lowStockCount);
      } catch {
        // non-critical
      }
    }

    void verifySession();
    void fetchLowStock();
  }, [router]);

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-sm font-medium text-slate-600">
        Loading RetailOS
      </div>
    );
  }

  const tenantName = tenant?.name ?? "RetailOS";
  const userName = session?.user?.name ?? "Owner";
  const initials = getInitials(userName);
  const dashboard = dashboardItem(verticalConfig.navigation);
  const navGroups = groupedNavigation(verticalConfig.navigation);

  return (
    <div className="min-h-screen bg-surface text-ink">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-white lg:block">
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          <div className="flex size-9 items-center justify-center rounded-md bg-emerald-600 text-white">
            <CreditCard className="size-5" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm font-semibold">RetailOS</div>
            <div className="text-xs text-slate-500">{tenantName}</div>
          </div>
        </div>
        <nav className="px-3 py-4" aria-label="Main navigation">
          {dashboard ? (
            <NavigationLink item={dashboard} pathname={pathname} lowStockCount={lowStockCount} />
          ) : null}
          {navGroups.map((group) => (
            <div key={group.label} className="mt-4 border-t border-border pt-3">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavigationLink key={item.href} item={item} pathname={pathname} lowStockCount={lowStockCount} />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-border bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center justify-between px-4 sm:px-6">
            <div>
              <div className="text-sm font-semibold text-slate-900">{tenantName}</div>
              <div className="text-xs text-slate-500">{verticalConfig.displayName} | GST enabled | INR</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden rounded-md border border-border px-3 py-1.5 text-xs text-slate-600 sm:block">Online</div>
              <div className="flex size-9 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">{initials}</div>
            </div>
          </div>
          <nav className="flex gap-2 overflow-x-auto border-t border-border px-2 py-2 lg:hidden" aria-label="Main navigation">
            {dashboard ? (
              <NavigationLink item={dashboard} pathname={pathname} lowStockCount={lowStockCount} mobile />
            ) : null}
            {navGroups.map((group) => (
              <div key={group.label} className="flex shrink-0 items-stretch gap-1 rounded-md border border-border bg-slate-50 p-1">
                <div className="flex w-14 items-center justify-center px-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <NavigationLink key={item.href} item={item} pathname={pathname} lowStockCount={lowStockCount} mobile />
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
        <main className="px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
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
  lowStockCount,
  mobile = false,
}: Readonly<{
  item: VerticalNavigationItem;
  pathname: string;
  lowStockCount: number;
  mobile?: boolean;
}>) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = getNavigationIcon(item);
  const isInventory = item.href === "/inventory";
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
          {isInventory && lowStockCount > 0 ? (
            <span className="absolute -right-2 -top-1.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
              {lowStockCount > 9 ? "9+" : lowStockCount}
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
        active && "bg-emerald-50 text-emerald-700",
      )}
    >
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-50", active && "bg-white")}>
        <Icon className={cn("size-4", iconClass)} aria-hidden="true" />
      </span>
      <span className="flex-1 truncate">{item.label}</span>
      {isInventory && lowStockCount > 0 ? (
        <span className="flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
          {lowStockCount > 99 ? "99+" : lowStockCount}
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
