const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001/api" : "/api");

export interface StorefrontTenant {
  name: string;
  slug: string;
  phone: string;
  address: string | null;
  gstEnabled: boolean;
  gstNumber: string | null;
  currency: string;
  logoUrl: string | null;
}

export interface StorefrontInfo {
  status: string;
  theme: "CLASSIC_RETAIL" | "PREMIUM_BRAND";
  defaultHostname: string;
  displayName: string;
  heroTitle: string | null;
  heroSubtitle: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  allowGuestCheckout: boolean;
  allowCustomerLogin: boolean;
  allowCod: boolean;
  paymentProvider: "PLATFORM_RAZORPAY" | "TENANT_RAZORPAY" | null;
  banners: Array<{ slot: "banner-1" | "banner-2"; imageUrl: string }>;
}

export interface StorefrontCategory {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  productCount: number;
  children: Array<{
    id: string;
    name: string;
    code: string;
    parentId: string | null;
    productCount: number;
  }>;
}

export interface StorefrontProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  categoryId: string | null;
  categoryName: string;
  categoryParentId: string | null;
  unit: string;
  mrp: number;
  sellingPrice: number;
  defaultDiscountPercent: number | null;
  discountPercent: number;
  gstRate: number;
  hsnCode: string | null;
  currentStock: number;
  imageUrl: string | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  hasVariants: boolean;
  grouped: boolean;
  groupId: string | null;
  groupName: string | null;
  variantAttributeLabel: string | null;
  variantCount: number;
  variantLabels: string[];
  defaultVariantLabel: string | null;
}

export interface StorefrontProductVariant {
  id: string;
  productId: string;
  label: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  sellingPrice: number;
  mrp: number;
  currentStock: number;
  imageUrl: string | null;
  unit: string;
  attributes: Record<string, unknown>;
}

export interface StorefrontProductDetail extends StorefrontProduct {
  variants: StorefrontProductVariant[];
  specifications: Array<{
    label: string;
    value: string;
  }>;
}

export interface StorefrontBootstrap {
  tenant: StorefrontTenant;
  storefront: StorefrontInfo;
  categories: StorefrontCategory[];
  products: StorefrontProduct[];
  productFilters: {
    brands: string[];
    sizes: string[];
    colors: string[];
    priceRange: {
      min: number;
      max: number;
    };
  };
  checkout: {
    deliveryCharge: number;
    freeDeliveryAbove: number;
    razorpayKeyId: string | null;
    paymentMethods: Array<"COD" | "RAZORPAY">;
  };
}

export interface StorefrontCustomer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

export interface StorefrontCartItemInput {
  productId: string;
  quantity: number;
}

export interface StorefrontCouponResponse {
  code: string;
  discount: number;
  label: string;
}

export interface StorefrontCheckoutPayload {
  customer: {
    name: string;
    phone: string;
    email?: string | undefined;
    address: string;
    city?: string | undefined;
    state?: string | undefined;
    postalCode?: string | undefined;
  };
  items: StorefrontCartItemInput[];
  paymentMethod: "COD" | "RAZORPAY";
  couponCode?: string | undefined;
  delivery?: {
    address?: string | undefined;
    notes?: string | undefined;
    scheduledAt?: string | undefined;
  } | undefined;
}

export interface StorefrontOrder {
  invoiceId: string;
  orderNumber: string;
  status: string;
  subtotal: number;
  totalDiscount: number;
  totalCgst: number;
  totalSgst: number;
  deliveryCharge: number;
  grandTotal: number;
  amountDue: number;
  deliveryId: string | null;
  deliveryAddress: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unit: string;
    sellingPrice: number;
    total: number;
  }>;
}

export interface StorefrontCheckoutResponse {
  order: StorefrontOrder;
  razorpay: {
    keyId: string;
    orderId: string;
    amount: number;
    currency: "INR";
    name: string;
    description: string;
    prefill: {
      name: string;
      contact: string;
      email?: string | undefined;
    };
  } | null;
}

export interface StorefrontProductListResponse {
  data: StorefrontProduct[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  filters: StorefrontBootstrap["productFilters"];
}

export interface StorefrontSearchResponse {
  query: string;
  suggestions: StorefrontProduct[];
}

export async function getStorefrontBootstrap(
  locator: { tenantSlug?: string; host?: string },
  options: { search?: string; categoryId?: string } = {},
): Promise<StorefrontBootstrap> {
  const query = new URLSearchParams();
  if (locator.host) {
    query.set("host", locator.host);
  }
  if (options.search) {
    query.set("search", options.search);
  }
  if (options.categoryId) {
    query.set("categoryId", options.categoryId);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const path = locator.tenantSlug ? `/public/storefront/${locator.tenantSlug}/bootstrap${suffix}` : `/public/storefront/bootstrap${suffix}`;
  return fetchPublicJson<StorefrontBootstrap>(path);
}

export async function getStorefrontCategories(tenantSlug: string): Promise<{ categories: StorefrontCategory[] }> {
  return fetchPublicJson<{ categories: StorefrontCategory[] }>(`/public/storefront/${tenantSlug}/categories`);
}

export async function getStorefrontCategoryProducts(
  tenantSlug: string,
  categoryId: string,
  options: {
    search?: string;
    brand?: string;
    size?: string;
    color?: string;
    minPrice?: number;
    maxPrice?: number;
    discountOnly?: boolean;
    sort?: "FEATURED" | "PRICE_ASC" | "PRICE_DESC" | "NEWEST" | "DISCOUNT" | "NAME";
    page?: number;
    pageSize?: number;
  } = {},
): Promise<StorefrontProductListResponse> {
  const query = new URLSearchParams();
  if (options.search) query.set("search", options.search);
  if (options.brand) query.set("brand", options.brand);
  if (options.size) query.set("size", options.size);
  if (options.color) query.set("color", options.color);
  if (options.minPrice !== undefined) query.set("minPrice", String(options.minPrice));
  if (options.maxPrice !== undefined) query.set("maxPrice", String(options.maxPrice));
  if (options.discountOnly) query.set("discountOnly", "true");
  if (options.sort) query.set("sort", options.sort);
  if (options.page) query.set("page", String(options.page));
  if (options.pageSize) query.set("pageSize", String(options.pageSize));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return fetchPublicJson<StorefrontProductListResponse>(`/public/storefront/${tenantSlug}/categories/${categoryId}/products${suffix}`);
}

export async function getStorefrontProducts(
  tenantSlug: string,
  options: {
    search?: string;
    categoryId?: string;
    brand?: string;
    size?: string;
    color?: string;
    minPrice?: number;
    maxPrice?: number;
    discountOnly?: boolean;
    sort?: "FEATURED" | "PRICE_ASC" | "PRICE_DESC" | "NEWEST" | "DISCOUNT" | "NAME";
    page?: number;
    pageSize?: number;
  } = {},
): Promise<StorefrontProductListResponse> {
  if (options.categoryId) {
    return getStorefrontCategoryProducts(tenantSlug, options.categoryId, options);
  }

  const query = new URLSearchParams();
  if (options.search) query.set("search", options.search);
  if (options.brand) query.set("brand", options.brand);
  if (options.size) query.set("size", options.size);
  if (options.color) query.set("color", options.color);
  if (options.minPrice !== undefined) query.set("minPrice", String(options.minPrice));
  if (options.maxPrice !== undefined) query.set("maxPrice", String(options.maxPrice));
  if (options.discountOnly) query.set("discountOnly", "true");
  if (options.sort) query.set("sort", options.sort);
  if (options.page) query.set("page", String(options.page));
  if (options.pageSize) query.set("pageSize", String(options.pageSize));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return fetchPublicJson<StorefrontProductListResponse>(`/public/storefront/${tenantSlug}/products${suffix}`);
}

export async function getStorefrontProductDetail(
  tenantSlug: string,
  productId: string,
): Promise<{
  product: StorefrontProductDetail;
  relatedProducts: StorefrontProduct[];
  frequentlyBoughtTogether: StorefrontProduct[];
}> {
  return fetchPublicJson(`/public/storefront/${tenantSlug}/products/${productId}`);
}

export async function searchStorefrontProducts(
  tenantSlug: string,
  queryText: string,
  limit = 8,
): Promise<StorefrontSearchResponse> {
  const query = new URLSearchParams({
    query: queryText,
    limit: String(limit),
  });
  return fetchPublicJson<StorefrontSearchResponse>(`/public/storefront/${tenantSlug}/search?${query.toString()}`);
}

export async function validateStorefrontCoupon(
  tenantSlug: string,
  payload: { code: string; items: StorefrontCartItemInput[] },
): Promise<StorefrontCouponResponse> {
  return fetchPublicJson<StorefrontCouponResponse>(`/public/storefront/${tenantSlug}/coupons/validate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function createStorefrontCheckout(
  tenantSlug: string,
  payload: StorefrontCheckoutPayload,
): Promise<StorefrontCheckoutResponse> {
  return fetchPublicJson<StorefrontCheckoutResponse>(`/public/storefront/${tenantSlug}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function verifyStorefrontRazorpay(
  tenantSlug: string,
  payload: {
    invoiceId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  },
): Promise<{ verified: true; order: StorefrontOrder }> {
  return fetchPublicJson<{ verified: true; order: StorefrontOrder }>(`/public/storefront/${tenantSlug}/checkout/verify-razorpay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function registerStorefrontCustomer(
  tenantSlug: string,
  payload: {
    name: string;
    phone: string;
    email?: string | undefined;
    password: string;
    address: string;
    city?: string | undefined;
    state?: string | undefined;
    postalCode?: string | undefined;
  },
): Promise<{ customer: StorefrontCustomer }> {
  return fetchPublicJson<{ customer: StorefrontCustomer }>(`/public/storefront/${tenantSlug}/customers/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function loginStorefrontCustomer(
  tenantSlug: string,
  payload: { phone: string; password: string },
): Promise<{ customer: StorefrontCustomer }> {
  return fetchPublicJson<{ customer: StorefrontCustomer }>(`/public/storefront/${tenantSlug}/customers/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function logoutStorefrontCustomer(tenantSlug: string): Promise<void> {
  await fetchPublicJson<{ status: string }>(`/public/storefront/${tenantSlug}/customers/logout`, {
    method: "POST",
  });
}

export async function getStorefrontCustomer(tenantSlug: string): Promise<{ customer: StorefrontCustomer | null }> {
  return fetchPublicJson<{ customer: StorefrontCustomer | null }>(`/public/storefront/${tenantSlug}/customers/me`);
}

export async function listStorefrontCustomerOrders(tenantSlug: string): Promise<{ orders: StorefrontOrder[] }> {
  return fetchPublicJson<{ orders: StorefrontOrder[] }>(`/public/storefront/${tenantSlug}/customers/orders`);
}

export function storefrontImageUrl(path: string | null): string | null {
  if (!path) {
    return null;
  }

  return path.startsWith("/api/") ? `${apiBaseUrl.replace(/\/api$/, "")}${path}` : path;
}

async function fetchPublicJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<T>;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? "Request failed";
  } catch {
    return "Request failed";
  }
}
