"use client";

import type { VerticalConfig, VerticalNavigationItem } from "@retailos/shared";
import { pharmacyConfig } from "@retailos/vertical-configs";
import { AlertTriangle, CreditCard } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { iconMap } from "@/components/shared/icon-map";
import { getCurrentVerticalConfig } from "@/lib/api-client";
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

    void verifySession();
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
        <nav className="space-y-1 px-3 py-4">
          {verticalConfig.navigation.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = getNavigationIcon(item);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-slate-600",
                  active && "bg-emerald-50 text-emerald-700",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
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
          <nav className="flex gap-1 overflow-x-auto border-t border-border px-2 py-2 lg:hidden">
            {verticalConfig.navigation.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = getNavigationIcon(item);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex min-w-24 flex-col items-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-slate-600",
                    active && "bg-emerald-50 text-emerald-700",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
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
