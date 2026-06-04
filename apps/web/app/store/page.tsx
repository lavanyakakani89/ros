import type { Metadata } from "next";
import { headers } from "next/headers";

import { StorefrontClient } from "@/components/store/storefront-client";

export const metadata: Metadata = {
  title: "Online Store | BizBil",
  description: "Order online with live BizBil stock, checkout, and delivery details.",
};

export default function StorePage() {
  const host = headers().get("host") ?? undefined;
  const tenantSlug = host && isLocalHost(host) ? process.env.NEXT_PUBLIC_STOREFRONT_TENANT_SLUG : undefined;
  return (
    <StorefrontClient
      {...(host ? { host } : {})}
      {...(tenantSlug ? { tenantSlug } : {})}
    />
  );
}

function isLocalHost(host: string): boolean {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
