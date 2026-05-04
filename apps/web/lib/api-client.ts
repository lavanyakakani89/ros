import type { TenantVertical, VerticalConfig } from "@retailos/shared";

import { clearStoredSession } from "@/lib/vertical-config";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001/api" : "/api");

export function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`;
}

export interface AuthUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: string;
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
  ownerPhone?: string;
  password: string;
}

export interface ProductPayload {
  name: string;
  sku?: string;
  barcode?: string;
  unit: string;
  mrp: number;
  sellingPrice: number;
  purchasePrice?: number;
  gstRate: number;
  hsnCode?: string;
  currentStock: number;
  reorderLevel?: number;
  verticalData?: Record<string, unknown>;
}

export interface ProductRecord extends Omit<ProductPayload, "mrp" | "sellingPrice" | "purchasePrice" | "gstRate" | "currentStock" | "reorderLevel"> {
  id: string;
  mrp: number | string;
  sellingPrice: number | string;
  purchasePrice?: number | string;
  gstRate: number | string;
  currentStock: number | string;
  reorderLevel?: number | string | null;
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

export async function login(payload: { tenantSlug: string; email: string; password: string }): Promise<AuthResponse> {
  return postJson<AuthResponse>("/auth/login", payload);
}

export async function registerShop(payload: RegisterPayload): Promise<AuthResponse> {
  return postJson<AuthResponse>("/auth/register", payload);
}

export async function refreshAuthSession(): Promise<AuthResponse> {
  return postJson<AuthResponse>("/auth/refresh", {});
}

export async function logout(): Promise<void> {
  await postJson("/auth/logout", {});
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
}> {
  const response = await fetch(`${apiBaseUrl}/vertical-config/current`, {
    credentials: "include",
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearBrowserSession();
    }

    throw new Error(await readApiError(response));
  }

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
  };
}

export async function listProducts(options: { lowStock?: boolean } = {}): Promise<PaginatedResponse<ProductRecord>> {
  const query = new URLSearchParams({ limit: "100" });
  if (options.lowStock) {
    query.set("lowStock", "true");
  }

  return createAuthenticatedApiClient().get<PaginatedResponse<ProductRecord>>(`/inventory/products?${query.toString()}`);
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

function clearBrowserSession() {
  if (typeof window === "undefined") {
    return;
  }

  clearStoredSession();
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? "Request failed";
  } catch {
    return "Request failed";
  }
}
