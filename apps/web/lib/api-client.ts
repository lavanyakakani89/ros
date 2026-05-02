import type { TenantVertical, VerticalConfig } from "@retailos/shared";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

export interface AuthUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: string;
}

export interface AuthResponse {
  user: AuthUser;
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
  };
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

export async function getCurrentVerticalConfig(accessToken: string): Promise<{ tenantId: string; config: VerticalConfig }> {
  const response = await fetch(`${apiBaseUrl}/vertical-config/current`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<{ tenantId: string; config: VerticalConfig }>;
}

export function createAuthenticatedApiClient(accessToken: string) {
  return {
    async get<T>(path: string) {
      const response = await fetch(`${apiBaseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      return response.json() as Promise<T>;
    },
    async post(path: string, payload: object) {
      const response = await fetch(`${apiBaseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      return response.json() as Promise<unknown>;
    },
  };
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
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

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? "Request failed";
  } catch {
    return "Request failed";
  }
}
