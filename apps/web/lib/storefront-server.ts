import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { StorefrontBootstrap } from "@/lib/storefront-api";

export interface ResolvedStorefrontRequest {
  bootstrap: StorefrontBootstrap;
  locator: {
    tenantSlug: string;
    host?: string;
  };
}

export async function resolveStorefrontRequest(options: {
  searchParams?: Record<string, string | string[] | undefined>;
  allowPreviewTenant?: boolean;
} = {}): Promise<ResolvedStorefrontRequest> {
  const requestHeaders = headers();
  const host = requestHeaders.get("host")?.toLowerCase() ?? "";
  const hostname = normalizeHostname(host);
  const previewTenant = options.allowPreviewTenant ? firstQueryValue(options.searchParams?.previewTenant) : null;

  if (previewTenant && hostname && isLocalHostname(hostname)) {
    const bootstrap = await fetchStorefrontBootstrap({ tenantSlug: previewTenant, requestHeaders });
    if (bootstrap) {
      return {
        bootstrap,
        locator: {
          tenantSlug: bootstrap.tenant.slug,
        },
      };
    }
  }

  if (host && await isActiveStorefrontHost(host, requestHeaders)) {
    const bootstrap = await fetchStorefrontBootstrap({ host, requestHeaders });
    if (bootstrap) {
      return {
        bootstrap,
        locator: {
          tenantSlug: bootstrap.tenant.slug,
          host,
        },
      };
    }
  }

  redirect("/dashboard");
}

export async function generateStorefrontMetadata(options: {
  searchParams?: Record<string, string | string[] | undefined>;
  allowPreviewTenant?: boolean;
  fallbackTitle?: string;
  fallbackDescription?: string;
} = {}): Promise<Metadata> {
  try {
    const resolved = await resolveStorefrontRequest({
      ...(options.searchParams ? { searchParams: options.searchParams } : {}),
      ...(options.allowPreviewTenant !== undefined ? { allowPreviewTenant: options.allowPreviewTenant } : {}),
    });
    return storefrontMetadata(resolved.bootstrap);
  } catch {
    return {
      title: options.fallbackTitle ?? "BizBil",
      description: options.fallbackDescription ?? "Retail operations and commerce powered by BizBil.",
    };
  }
}

export function storefrontMetadata(bootstrap: StorefrontBootstrap): Metadata {
  const title = `${bootstrap.storefront.displayName} | BizBil`;
  const description = bootstrap.storefront.heroSubtitle ?? `Shop online from ${bootstrap.tenant.name} with live stock synced from BizBil.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: bootstrap.storefront.displayName,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

async function fetchStorefrontBootstrap(input: {
  tenantSlug?: string;
  host?: string;
  requestHeaders: ReturnType<typeof headers>;
}): Promise<StorefrontBootstrap | null> {
  try {
    const query = input.host ? `?host=${encodeURIComponent(input.host)}` : "";
    const path = input.tenantSlug
      ? `/public/storefront/${input.tenantSlug}/bootstrap`
      : `/public/storefront/bootstrap${query}`;
    const response = await fetch(storefrontApiUrl(path, input.requestHeaders, input.host), {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }

    return await response.json() as StorefrontBootstrap;
  } catch {
    return null;
  }
}

async function isActiveStorefrontHost(host: string, requestHeaders: ReturnType<typeof headers>): Promise<boolean> {
  const hostname = normalizeHostname(host);
  if (!hostname || isLocalHostname(hostname) || appHostnames().has(hostname)) {
    return false;
  }

  try {
    const response = await fetch(storefrontApiUrl(`/public/storefront/bootstrap?host=${encodeURIComponent(host)}`, requestHeaders, host), {
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

function storefrontApiUrl(path: string, requestHeaders: ReturnType<typeof headers>, host?: string): string {
  const apiBase = process.env.SERVER_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (apiBase?.startsWith("http://") || apiBase?.startsWith("https://")) {
    return `${apiBase}${path}`;
  }

  const resolvedHost = host ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${protocol}://${resolvedHost}/api${path}`;
}

function appHostnames(): Set<string> {
  const values = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.TEST_APP_DOMAIN,
    process.env.APP_DOMAIN,
    process.env.NEXT_PUBLIC_STOREFRONT_ROOT_DOMAIN,
    "bizbil.com",
    "www.bizbil.com",
    "app.bizbil.com",
    "api.bizbil.com",
    "test.bizbil.com",
  ];

  return new Set(values.flatMap((value) => {
    const hostname = normalizeHostname(value ?? "");
    return hostname ? [hostname] : [];
  }));
}

function normalizeHostname(value: string): string | null {
  const withoutProtocol = value.trim().toLowerCase().replace(/^https?:\/\//, "");
  const hostname = withoutProtocol.split("/")[0]?.split(":")[0] ?? "";
  return hostname || null;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function firstQueryValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (Array.isArray(value)) {
    const first = value.find((entry) => entry.trim());
    return first?.trim() || null;
  }

  return null;
}
