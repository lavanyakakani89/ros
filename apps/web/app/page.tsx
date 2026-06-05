import type { Metadata } from "next";

import { StorefrontPortal } from "@/components/store/storefront-portal";
import { generateStorefrontMetadata, resolveStorefrontRequest } from "@/lib/storefront-server";

export async function generateMetadata({
  searchParams,
}: Readonly<{
  searchParams?: Record<string, string | string[] | undefined>;
}>): Promise<Metadata> {
  return generateStorefrontMetadata({
    ...(searchParams ? { searchParams } : {}),
    allowPreviewTenant: true,
  });
}

export default async function HomePage({
  searchParams,
}: Readonly<{
  searchParams?: Record<string, string | string[] | undefined>;
}>) {
  const resolved = await resolveStorefrontRequest({
    ...(searchParams ? { searchParams } : {}),
    allowPreviewTenant: true,
  });

  return (
    <StorefrontPortal
      initialBootstrap={resolved.bootstrap}
      locator={resolved.locator}
      page={{ kind: "home" }}
    />
  );
}
