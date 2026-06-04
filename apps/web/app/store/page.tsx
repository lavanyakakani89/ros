import type { Metadata } from "next";
import { headers } from "next/headers";

import { StorefrontClient } from "@/components/store/storefront-client";

export const metadata: Metadata = {
  title: "Online Store | BizBil",
  description: "Order online with live BizBil stock, checkout, and delivery details.",
};

export default function StorePage() {
  const host = headers().get("host") ?? undefined;
  return (
    <StorefrontClient
      {...(host ? { host } : {})}
      {...(process.env.NEXT_PUBLIC_STOREFRONT_TENANT_SLUG ? { tenantSlug: process.env.NEXT_PUBLIC_STOREFRONT_TENANT_SLUG } : {})}
    />
  );
}
