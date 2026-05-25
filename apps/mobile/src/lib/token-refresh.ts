import { clearTokens, getRefreshToken, storeTokens } from "./auth";
import { API_BASE_URL } from "./config";

interface RefreshResponse {
  tokens?: {
    accessToken?: string;
    refreshToken?: string;
  };
  accessToken?: string;
  refreshToken?: string;
}

export async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const base = API_BASE_URL.replace(/\/$/, "");
    const refreshUrl = base.endsWith("/api") ? `${base}/auth/refresh` : `${base}/api/auth/refresh`;
    const response = await fetch(refreshUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      await clearTokens();
      return false;
    }

    const payload = await response.json() as RefreshResponse;
    const nextAccess = payload.tokens?.accessToken ?? payload.accessToken;
    const nextRefresh = payload.tokens?.refreshToken ?? payload.refreshToken ?? refreshToken;
    if (!nextAccess) {
      await clearTokens();
      return false;
    }
    await storeTokens(nextAccess, nextRefresh);
    return true;
  } catch {
    await clearTokens();
    return false;
  }
}
