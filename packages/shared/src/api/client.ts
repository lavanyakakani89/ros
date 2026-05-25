export interface ApiClientOptions {
  baseUrl: string;
  getAuthHeader: () => Promise<string | null>;
  getImpersonationHeader: () => Promise<string | null>;
  handleAuthError?: () => Promise<boolean>;
  onAuthFailure?: () => void;
  timeoutMs?: number;
}

export class AuthError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "AuthError";
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApiClient(options: ApiClientOptions) {
  function buildUrl(path: string): string {
    const base = options.baseUrl.replace(/\/$/, "");
    if (base.endsWith("/api") && path.startsWith("/api/")) {
      return `${base}${path.slice(4)}`;
    }
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    const authHeader = await options.getAuthHeader();
    if (authHeader) {
      headers.Authorization = authHeader;
    }
    const impersonationHeader = await options.getImpersonationHeader();
    if (impersonationHeader) {
      headers["X-Impersonation-Token"] = impersonationHeader;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
    let response: Response;
    try {
      response = await fetch(buildUrl(path), {
        method,
        headers,
        signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401) {
      if (!retried && options.handleAuthError && await options.handleAuthError()) {
        return request<T>(method, path, body, true);
      }
      options.onAuthFailure?.();
      throw new AuthError();
    }

    if (!response.ok) {
      let message = response.statusText || "Request failed";
      try {
        const payload = await response.json() as { error?: string; message?: string };
        message = payload.message ?? payload.error ?? message;
      } catch {
        // Keep the status text fallback.
      }
      throw new ApiError(response.status, message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return await response.json() as T;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    delete: <T>(path: string) => request<T>("DELETE", path),
  };
}
