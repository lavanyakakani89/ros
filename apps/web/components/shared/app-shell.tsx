"use client";

import type { VerticalConfig, VerticalNavigationItem } from "@retailos/shared";
import { pharmacyConfig } from "@retailos/vertical-configs";
import {
  AlertTriangle,
  ChevronDown,
  CreditCard,
  FileText,
  History,
  KeyRound,
  LogOut,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Settings,
  ShieldAlert,
  User,
  Users,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { iconMap } from "@/components/shared/icon-map";
import { createAuthenticatedApiClient, getCurrentVerticalConfig, logout } from "@/lib/api-client";
import {
  clearStoredImpersonation,
  type StoredImpersonation,
  useImpersonationStore,
} from "@/lib/impersonation";
import { dashboardItem, groupedNavigation } from "@/lib/navigation-groups";
import { cn } from "@/lib/utils";
import {
  storeTenant,
  storeAuthSession,
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
  const impersonation = useImpersonationStore((state) => state.impersonation);
  const setImpersonation = useImpersonationStore((state) => state.setImpersonation);
  const [now, setNow] = useState(() => Date.now());
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pathname === "/impersonate") {
      setCheckingSession(false);
      return;
    }

    const storedSidebar = window.localStorage.getItem("retailos.sidebarCollapsed");

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
        if (current.user) {
          const nextSession = { user: current.user };
          storeAuthSession(nextSession);
          setSession(nextSession);
        } else {
          setSession(null);
          setBadgeCounts({});
        }
        setImpersonation(current.impersonation ?? null);
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
          api.get<Array<{ status: string }>>("/delivery?scope=active"),
          api.get<{ data: Array<{ amountDue?: string | number; status?: string }> }>("/billing/invoices?unpaid=true&limit=100"),
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
  }, [pathname, router, setImpersonation]);

  useEffect(() => {
    if (!accountMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-sm font-medium text-slate-600">
        Loading RetailOS
      </div>
    );
  }

  const tenantName = tenant?.name ?? "RetailOS";
  const userName = impersonation?.superAdminName ?? session?.user?.name ?? "RetailOS User";
  const userEmail = impersonation?.superAdminEmail ?? session?.user?.email ?? null;
  const role = session?.user?.role ?? "USER";
  const initials = getInitials(userName);
  const appEnvironment = (process.env.NEXT_PUBLIC_APP_ENV ?? "production").toLowerCase();
  const environmentLabel = appEnvironment === "production" ? null : appEnvironment.toUpperCase();
  const dashboard = dashboardItem(verticalConfig.navigation);
  const navGroups = groupedNavigation(verticalConfig.navigation);
  const sidebarWidthClass = sidebarCollapsed ? "lg:pl-20" : "lg:pl-64";
  const accountLinks = [
    { href: "/settings#shop-details", label: "Shop settings", description: "GST, address, and shop details", icon: Settings },
    { href: "/settings#users", label: "Users & roles", description: "Owners, managers, staff, delivery", icon: Users },
    { href: "/settings/whatsapp", label: "WhatsApp Business", description: "Orders and customer updates", icon: MessageCircle },
    { href: "/settings/printer", label: "Printer setup", description: "Thermal printer and local agent", icon: Printer },
    { href: "/settings/templates", label: "Invoice templates", description: "Thermal, A5, and A4 formats", icon: FileText },
    { href: "/settings#password", label: "Change password", description: "Secure this login", icon: KeyRound },
    { href: "/audit", label: "Audit log", description: "Track important activity", icon: History },
  ] satisfies AccountMenuLink[];

  if (pathname === "/impersonate") {
    return <>{children}</>;
  }

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
    await createAuthenticatedApiClient()
      .post("/superadmin/impersonate/end", { sessionId: impersonation?.sessionId })
      .catch(() => null);
    clearStoredImpersonation();
    setImpersonation(null);
    window.close();
    window.location.href = "/impersonation-ended";
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
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-sm font-semibold text-slate-900">{tenantName}</div>
                  {environmentLabel ? (
                    <span className="shrink-0 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                      {environmentLabel}
                    </span>
                  ) : null}
                </div>
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
              <div className="relative" ref={accountMenuRef}>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-transparent bg-slate-900 px-2 text-sm font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                  onClick={() => setAccountMenuOpen((value) => !value)}
                  aria-haspopup="menu"
                  aria-expanded={accountMenuOpen}
                  aria-label="Open account menu"
                >
                  <span className="flex size-7 items-center justify-center rounded bg-slate-950">{initials}</span>
                  <ChevronDown className="size-3.5 text-slate-300" aria-hidden="true" />
                </button>
                {accountMenuOpen ? (
                  <AccountMenu
                    links={accountLinks}
                    userName={userName}
                    userEmail={userEmail}
                    role={role}
                    tenantName={tenantName}
                    online={online}
                    impersonation={impersonation}
                    onNavigate={() => setAccountMenuOpen(false)}
                    onLogout={() => {
                      setAccountMenuOpen(false);
                      void handleLogout();
                    }}
                  />
                ) : null}
              </div>
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

interface AccountMenuLink {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

function AccountMenu({
  links,
  userName,
  userEmail,
  role,
  tenantName,
  online,
  impersonation,
  onNavigate,
  onLogout,
}: Readonly<{
  links: AccountMenuLink[];
  userName: string;
  userEmail: string | null;
  role: string;
  tenantName: string;
  online: boolean;
  impersonation: StoredImpersonation | null;
  onNavigate: () => void;
  onLogout: () => void;
}>) {
  return (
    <div
      className="absolute right-0 top-11 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-border bg-white text-slate-800 shadow-xl"
      role="menu"
      aria-label="Account menu"
    >
      <div className="border-b border-border p-3">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
            <User className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-950">{userName}</div>
            <div className="truncate text-xs text-slate-500">{userEmail ?? tenantName}</div>
            {!impersonation ? <div className="mt-1 text-xs font-medium text-emerald-700">{formatRoleLabel(role)}</div> : null}
            {impersonation ? <div className="mt-1 text-xs font-medium text-amber-700">Support view is active</div> : null}
          </div>
        </div>
      </div>
      <div className="border-b border-border p-2">
        <div className="flex items-center gap-3 rounded-md px-2 py-2 text-sm">
          <span className={cn("flex size-8 items-center justify-center rounded-md", online ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
            <Wifi className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="font-medium text-slate-900">{online ? "Online" : "Offline"}</div>
            <div className="text-xs text-slate-500">Network and sync status</div>
          </div>
        </div>
      </div>
      <div className="p-2">
        {links.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
              role="menuitem"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-600">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-900">{item.label}</span>
                <span className="block truncate text-xs text-slate-500">{item.description}</span>
              </span>
            </Link>
          );
        })}
      </div>
      <div className="border-t border-border p-2">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm text-red-700 hover:bg-red-50"
          onClick={onLogout}
          role="menuitem"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700">
            <LogOut className="size-4" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-medium">{impersonation ? "Exit support view" : "Logout"}</span>
            <span className="block text-xs text-red-500">{impersonation ? "Return to super admin" : "End this session"}</span>
          </span>
        </button>
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

function formatRoleLabel(role: string): string {
  return role
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
