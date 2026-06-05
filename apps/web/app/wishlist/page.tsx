import { StorefrontPortal } from "@/components/store/storefront-portal";
import { resolveStorefrontRequest } from "@/lib/storefront-server";

export default async function WishlistPage({
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
      page={{ kind: "wishlist" }}
    />
  );
}
