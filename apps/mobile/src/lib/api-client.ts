import { createApiClient } from "@bizbil/shared";

import { API_BASE_URL } from "./config";
import { getAuthHeader } from "./auth";
import { getImpersonationHeaderToken } from "./impersonation";
import { refreshAccessToken } from "./token-refresh";
import { useAuthStore } from "@/stores/auth-store";

export const apiClient = createApiClient({
  baseUrl: API_BASE_URL,
  getAuthHeader,
  getImpersonationHeader: async () => {
    const token = getImpersonationHeaderToken();
    return token ? token : null;
  },
  handleAuthError: refreshAccessToken,
  onAuthFailure: () => useAuthStore.getState().clear(),
  timeoutMs: 30_000,
});
