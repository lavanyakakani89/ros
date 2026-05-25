import { useEffect } from "react";

import { apiClient } from "@/lib/api-client";
import { clearTokens, getAccessToken } from "@/lib/auth";
import { refreshAccessToken } from "@/lib/token-refresh";
import { useAuthStore } from "@/stores/auth-store";

interface CurrentConfigResponse {
  tenant: { id?: string; name: string; vertical?: string; gstEnabled?: boolean };
  user?: { id: string; name?: string; email?: string; role: "OWNER" | "MANAGER" | "STAFF" | "DELIVERY"; tenantId: string; storeId?: string | null };
}

export function useSession() {
  const { user, tenant, isAuthenticated, isLoading, setUser, setTenant, setLoading, clear } = useAuthStore();

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      setLoading(true);
      try {
        const token = await getAccessToken();
        if (!token) {
          clear();
          return;
        }
        let current: CurrentConfigResponse;
        try {
          current = await apiClient.get<CurrentConfigResponse>("/api/vertical-config/current");
        } catch {
          if (!await refreshAccessToken()) {
            await clearTokens();
            clear();
            return;
          }
          current = await apiClient.get<CurrentConfigResponse>("/api/vertical-config/current");
        }
        if (cancelled) return;
        if (current.user) {
          setUser({
            id: current.user.id,
            name: current.user.name ?? "RetailOS User",
            email: current.user.email ?? "",
            role: current.user.role,
            tenantId: current.user.tenantId,
            storeId: current.user.storeId ?? null,
          });
        }
        setTenant({
          id: current.tenant.id ?? current.user?.tenantId ?? "",
          name: current.tenant.name,
          vertical: current.tenant.vertical ?? "PHARMACY",
          gstEnabled: current.tenant.gstEnabled ?? true,
        });
      } catch {
        if (!cancelled) clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [clear, setLoading, setTenant, setUser]);

  return { isLoading, isAuthenticated, user, tenant };
}
