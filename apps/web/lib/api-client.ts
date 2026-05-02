import type { TenantVertical, VerticalConfig } from "@retailos/shared";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001/api" : "/api");

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
  };
  config: VerticalConfig;
}> {
  const response = await fetch(`${apiBaseUrl}/vertical-config/current`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<{
    tenantId: string;
    tenant: {
      name: string;
      slug: string;
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
    async post(path: string, payload: object) {
      const response = await fetchWithCookieAuth(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      return response.json() as Promise<unknown>;
    },
  };
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
    await refreshAuthSession();
    return fetchWithCookieAuth(path, init, false);
  }

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? "Request failed";
  } catch {
    return "Request failed";
  }
}
