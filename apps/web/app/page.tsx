import { redirect } from "next/navigation";
import { headers } from "next/headers";

export default async function HomePage() {
  const requestHeaders = headers();
  const host = requestHeaders.get("host")?.toLowerCase() ?? "";
  if (await isActiveStorefrontHost(host, requestHeaders)) {
    redirect("/store");
  }

  redirect("/dashboard");
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
  const apiBase = process.env.NEXT_PUBLIC_API_URL;
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

function normalizeHostname(value: string): string | null {
  const withoutProtocol = value.trim().toLowerCase().replace(/^https?:\/\//, "");
  const hostname = withoutProtocol.split("/")[0]?.split(":")[0] ?? "";
  return hostname || null;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
