import { StorefrontPortal } from "@/components/store/storefront-portal";
import { resolveStorefrontRequest } from "@/lib/storefront-server";

export default async function ProductPage({
  params,
  searchParams,
}: Readonly<{
  params: { productId: string };
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
      page={{ kind: "product", productId: params.productId }}
    />
  );
}
