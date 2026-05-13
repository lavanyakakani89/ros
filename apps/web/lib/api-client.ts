import type { TenantVertical, VerticalConfig } from "@retailos/shared";

import { ensureWriteAllowedDuringImpersonation, type StoredImpersonation } from "@/lib/impersonation";
import { clearStoredSession } from "@/lib/vertical-config";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001/api" : "/api");

let refreshAuthSessionPromise: Promise<AuthResponse> | null = null;

export function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`;
}

export type ShopRole = "OWNER" | "MANAGER" | "STAFF" | "DELIVERY";

export interface AuthUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  username?: string | null;
  role: ShopRole;
}

export interface AuthResponse {
  user: AuthUser;
}

export interface RegisterPayload {
  tenantName: string;
  tenantSlug: string;
  vertical: TenantVertical;
  phone: string;
  ownerName: string;
  ownerEmail: string;
  ownerUsername?: string | undefined;
  ownerPhone?: string;
  password: string;
}

export interface ProductPayload {
  name: string;
  sku?: string;
  barcode?: string;
  description?: string;
  partGroup?: string;
  legacySubCategoryId?: string;
  categoryId?: string;
  unit: string;
  mrp: number;
  sellingPrice: number;
  purchasePrice?: number;
  wholesalePrice?: number;
  defaultDiscountPercent?: number;
  gstRate: number;
  cessRate?: number;
  hsnCode?: string;
  currentStock: number;
  reorderLevel?: number;
  purchaseUnit?: string;
  salesUnit?: string;
  alternateUnit?: string;
  conversionValue?: number;
  godown?: string;
  rack?: string;
  defaultSaleQty?: number;
  verticalData?: Record<string, unknown>;
}

export interface ProductRecord extends Omit<ProductPayload, "mrp" | "sellingPrice" | "purchasePrice" | "wholesalePrice" | "defaultDiscountPercent" | "gstRate" | "cessRate" | "currentStock" | "reorderLevel" | "conversionValue" | "defaultSaleQty"> {
  id: string;
  mrp: number | string;
  sellingPrice: number | string;
  purchasePrice?: number | string;
  wholesalePrice?: number | string | null;
  defaultDiscountPercent?: number | string | null;
  gstRate: number | string;
  cessRate?: number | string | null;
  currentStock: number | string;
  reorderLevel?: number | string | null;
  conversionValue?: number | string | null;
  defaultSaleQty?: number | string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export async function login(payload: { tenantSlug: string; identifier: string; password: string }): Promise<AuthResponse> {
  return postJson<AuthResponse>("/auth/login", payload);
}

export async function registerShop(payload: RegisterPayload): Promise<AuthResponse> {
  return postJson<AuthResponse>("/auth/register", payload);
}

export async function refreshAuthSession(): Promise<AuthResponse> {
  refreshAuthSessionPromise ??= postJson<AuthResponse>("/auth/refresh", {}).finally(() => {
    refreshAuthSessionPromise = null;
  });

  return refreshAuthSessionPromise;
}

export async function logout(): Promise<void> {
  try {
    await postJson("/auth/logout", {});
  } finally {
    clearBrowserSession();
  }
}

export async function getCurrentVerticalConfig(): Promise<{
  tenantId: string;
  tenant: {
    name: string;
    slug: string;
    status: string;
    gstEnabled: boolean;
    gstNumber?: string | null;
  };
  config: VerticalConfig;
  user?: {
    id: string;
    tenantId: string;
    role: ShopRole;
  } | null;
  isImpersonated?: boolean;
  impersonation?: StoredImpersonation | null;
}> {
  const response = await fetchWithCookieAuth("/vertical-config/current");

  return response.json() as Promise<{
    tenantId: string;
    tenant: {
      name: string;
      slug: string;
      status: string;
      gstEnabled: boolean;
      gstNumber?: string | null;
    };
    config: VerticalConfig;
    user?: {
      id: string;
      tenantId: string;
      role: ShopRole;
    } | null;
    isImpersonated?: boolean;
    impersonation?: StoredImpersonation | null;
  }>;
}

export function createAuthenticatedApiClient() {
  return {
    async get<T>(path: string) {
      const response = await fetchWithCookieAuth(path);
      return response.json() as Promise<T>;
    },
    async post<T = unknown>(path: string, payload: object) {
      const response = await fetchWithCookieAuth(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      return response.json() as Promise<T>;
    },
    async put<T = unknown>(path: string, payload: object) {
      const response = await fetchWithCookieAuth(path, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      return response.json() as Promise<T>;
    },
    async delete<T = unknown>(path: string) {
      const response = await fetchWithCookieAuth(path, {
        method: "DELETE",
      });

      return response.json() as Promise<T>;
    },
    async upload<T = unknown>(path: string, file: File) {
      const form = new FormData();
      form.append("file", file);
      const response = await fetchWithCookieAuth(path, {
        method: "POST",
        body: form,
      });

      return response.json() as Promise<T>;
    },
    async uploadForm<T = unknown>(path: string, form: FormData) {
      const response = await fetchWithCookieAuth(path, {
        method: "POST",
        body: form,
      });

      return response.json() as Promise<T>;
    },
    async download(path: string) {
      const response = await fetchWithCookieAuth(path);
      return response.blob();
    },
  };
}

export async function downloadApiFile(path: string, filename: string): Promise<void> {
  const blob = await createAuthenticatedApiClient().download(path);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function listProducts(options: { lowStock?: boolean; page?: number; limit?: number; search?: string } = {}): Promise<PaginatedResponse<ProductRecord>> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 100) });
  if (options.page) {
    query.set("page", String(options.page));
  }
  if (options.search) {
    query.set("search", options.search);
  }
  if (options.lowStock) {
    query.set("lowStock", "true");
  }

  return createAuthenticatedApiClient().get<PaginatedResponse<ProductRecord>>(`/inventory/products?${query.toString()}`);
}

export async function lookupProductByCode(code: string): Promise<ProductRecord | null> {
  try {
    return await createAuthenticatedApiClient().get<ProductRecord>(`/inventory/products/lookup?code=${encodeURIComponent(code)}`);
  } catch (error) {
    if (error instanceof Error && error.message === "Product not found") {
      return null;
    }

    throw error;
  }
}

export async function listAllProducts(options: { lowStock?: boolean; search?: string; pageSize?: number } = {}): Promise<PaginatedResponse<ProductRecord>> {
  const limit = options.pageSize ?? 100;
  const productsById = new Map<string, ProductRecord>();
  let page = 1;
  let total = 0;

  do {
    const request: { lowStock?: boolean; page: number; limit: number; search?: string } = { page, limit };
    if (options.lowStock !== undefined) {
      request.lowStock = options.lowStock;
    }
    if (options.search !== undefined) {
      request.search = options.search;
    }
    const result = await listProducts(request);
    for (const product of result.data) {
      productsById.set(product.id, product);
    }
    total = result.total;
    if (result.data.length === 0) {
      break;
    }
    page += 1;
  } while ((page - 1) * limit < total);

  const products = [...productsById.values()];

  return {
    data: products,
    page: 1,
    limit: products.length,
    total,
  };
}

export async function createProduct(payload: ProductPayload): Promise<ProductRecord> {
  return createAuthenticatedApiClient().post<ProductRecord>("/inventory/products", payload);
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<T>;
}

async function fetchWithCookieAuth(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  if (isWriteMethod(init.method) && !path.startsWith("/superadmin/")) {
    ensureWriteAllowedDuringImpersonation();
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
  });

  if (response.status === 401 && retry) {
    try {
      await refreshAuthSession();
      return await fetchWithCookieAuth(path, init, false);
    } catch {
      clearBrowserSession();
      throw new Error("Session expired. Please sign in again.");
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearBrowserSession();
    }

    throw new Error(await readApiError(response));
  }

  return response;
}

function isWriteMethod(method: string | undefined): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes((method ?? "GET").toUpperCase());
}

function clearBrowserSession() {
  if (typeof window === "undefined") {
    return;
  }

  clearStoredSession();
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string; issues?: Array<{ field?: string; message?: string }> };
    if (body.issues?.length) {
      return body.issues
        .slice(0, 3)
        .map((issue) => `${fieldLabel(issue.field ?? "")}: ${issue.message ?? "Invalid value"}`)
        .join("; ");
    }

    return body.error ?? body.message ?? "Request failed";
  } catch {
    return "Request failed";
  }
}

function fieldLabel(field: string): string {
  if (!field) {
    return "Request";
  }

  return field
    .replace(/\.(\d+)\./g, " $1 ")
    .replace(/\./g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}
