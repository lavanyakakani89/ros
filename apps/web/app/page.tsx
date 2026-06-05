import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { StorefrontClient } from "@/components/store/storefront-client";

export async function generateMetadata({
  searchParams,
}: Readonly<{
  searchParams?: Record<string, string | string[] | undefined>;
}>): Promise<Metadata> {
  const requestHeaders = headers();
  const host = requestHeaders.get("host")?.toLowerCase() ?? "";
  const hostname = normalizeHostname(host);
  const previewTenant = firstQueryValue(searchParams?.previewTenant);

  if (previewTenant && hostname && isLocalHostname(hostname)) {
    const bootstrap = await fetchStorefrontBootstrapMetadata(previewTenant, requestHeaders);
    if (bootstrap) {
      return storefrontMetadata(bootstrap);
    }
  }

  if (await isActiveStorefrontHost(host, requestHeaders)) {
    const bootstrap = await fetchStorefrontBootstrapMetadata(undefined, requestHeaders, host);
    if (bootstrap) {
      return storefrontMetadata(bootstrap);
    }
  }

  return {
    title: "BizBil",
    description: "Retail operations and commerce powered by BizBil.",
  };
}

export default async function HomePage({
  searchParams,
}: Readonly<{
  searchParams?: Record<string, string | string[] | undefined>;
}>) {
  const requestHeaders = headers();
  const host = requestHeaders.get("host")?.toLowerCase() ?? "";
  const hostname = normalizeHostname(host);
  const previewTenant = firstQueryValue(searchParams?.previewTenant);

  if (previewTenant && hostname && isLocalHostname(hostname)) {
    return <StorefrontClient tenantSlug={previewTenant} />;
  }

  if (await isActiveStorefrontHost(host, requestHeaders)) {
    return <StorefrontClient host={host} />;
  }

  redirect("/dashboard");
}

async function fetchStorefrontBootstrapMetadata(
  tenantSlug: string | undefined,
  requestHeaders: ReturnType<typeof headers>,
  host?: string,
): Promise<{
  tenant: { name: string };
  storefront: { displayName: string; heroSubtitle: string | null; defaultHostname: string };
} | null> {
  try {
    const path = tenantSlug ? `/public/storefront/${tenantSlug}/bootstrap` : `/public/storefront/bootstrap?host=${encodeURIComponent(host ?? "")}`;
    const apiBase = process.env.SERVER_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
    const protocol = requestHeaders.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
    const resolvedHost = host ?? requestHeaders.get("host") ?? "localhost:3000";
    const url = apiBase?.startsWith("http://") || apiBase?.startsWith("https://")
      ? `${apiBase}${path}`
      : `${protocol}://${resolvedHost}/api${path}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return await response.json() as {
      tenant: { name: string };
      storefront: { displayName: string; heroSubtitle: string | null; defaultHostname: string };
    };
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
    const response = await fetch(storefrontBootstrapUrl(host, requestHeaders), {
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

function storefrontBootstrapUrl(host: string, requestHeaders: ReturnType<typeof headers>): string {
  const apiBase = process.env.SERVER_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  const path = `/public/storefront/bootstrap?host=${encodeURIComponent(host)}`;
  if (apiBase?.startsWith("http://") || apiBase?.startsWith("https://")) {
    return `${apiBase}${path}`;
  }

  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const protocol = forwardedProto ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${protocol}://${host}/api${path}`;
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

function storefrontMetadata(bootstrap: {
  tenant: { name: string };
  storefront: { displayName: string; heroSubtitle: string | null; defaultHostname: string };
}): Metadata {
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
