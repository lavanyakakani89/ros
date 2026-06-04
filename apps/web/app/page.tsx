import { redirect } from "next/navigation";
import { headers } from "next/headers";

export default function HomePage() {
  const host = headers().get("host")?.toLowerCase() ?? "";
  if (isStorefrontHost(host)) {
    redirect("/store");
  }

  redirect("/dashboard");
}

function isStorefrontHost(host: string): boolean {
  const hostname = host.split(":")[0] ?? host;
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") {
    return false;
  }

  const rootDomain = process.env.NEXT_PUBLIC_STOREFRONT_ROOT_DOMAIN ?? "bizbil.com";
  const reservedBizbilHosts = new Set(["bizbil.com", "www.bizbil.com", "app.bizbil.com", "api.bizbil.com"]);
  if (hostname.endsWith(`.${rootDomain}`) && !reservedBizbilHosts.has(hostname)) {
    return true;
  }

  const customHosts = (process.env.NEXT_PUBLIC_STOREFRONT_CUSTOM_HOSTS ?? "sivsanoils.in,www.sivsanoils.in")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return customHosts.includes(hostname);
}
