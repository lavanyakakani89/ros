import { StorefrontPortal } from "@/components/store/storefront-portal";
import { resolveStorefrontRequest } from "@/lib/storefront-server";

export default async function SearchPage({
  searchParams,
}: Readonly<{
  searchParams?: Record<string, string | string[] | undefined>;
}>) {
  const resolved = await resolveStorefrontRequest({
    ...(searchParams ? { searchParams } : {}),
    allowPreviewTenant: true,
  });
  const queryValue = searchParams?.q;
  const query = typeof queryValue === "string" ? queryValue : Array.isArray(queryValue) ? queryValue[0] ?? "" : "";

  return (
    <StorefrontPortal
      initialBootstrap={resolved.bootstrap}
      locator={resolved.locator}
      page={{ kind: "search", query }}
    />
  );
}
