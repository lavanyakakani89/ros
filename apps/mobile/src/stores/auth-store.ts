import { create } from "zustand";
import type { UserRole } from "@retailos/shared";

interface AuthState {
  user: { id: string; name: string; email: string; role: UserRole; tenantId: string; storeId?: string | null } | null;
  tenant: { id: string; name: string; vertical: string; gstEnabled: boolean } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: AuthState["user"]) => void;
  setTenant: (tenant: AuthState["tenant"]) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tenant: null,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setTenant: (tenant) => set({ tenant }),
  setLoading: (isLoading) => set({ isLoading }),
  clear: () => set({ user: null, tenant: null, isAuthenticated: false }),
}));
