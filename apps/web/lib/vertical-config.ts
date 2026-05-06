import type { VerticalConfig } from "@retailos/shared";

import { clearStoredImpersonation } from "@/lib/impersonation";

const authStorageKey = "retailos.auth";
const verticalConfigStorageKey = "retailos.verticalConfig";
const tenantStorageKey = "retailos.tenant";

export interface StoredAuthSession {
  user?: {
    name?: string;
    email?: string;
  };
}

export interface StoredTenant {
  name: string;
  slug: string;
  status?: string;
  gstEnabled?: boolean;
  gstNumber?: string | null;
}

export function storeAuthSession(input: StoredAuthSession) {
  window.localStorage.setItem(authStorageKey, JSON.stringify({
    user: input.user ? { name: input.user.name, email: input.user.email } : undefined,
  }));
}

export function hasStoredAuthSession(): boolean {
  const raw = window.localStorage.getItem(authStorageKey);
  return Boolean(raw);
}

export function getStoredAuthSession(): StoredAuthSession | null {
  const raw = window.localStorage.getItem(authStorageKey);
  return raw ? (JSON.parse(raw) as StoredAuthSession) : null;
}

export function clearStoredSession() {
  window.localStorage.removeItem(authStorageKey);
  window.localStorage.removeItem(verticalConfigStorageKey);
  window.localStorage.removeItem(tenantStorageKey);
  clearStoredImpersonation();
}

export function storeTenant(tenant: StoredTenant) {
  window.localStorage.setItem(tenantStorageKey, JSON.stringify(tenant));
}

export function getStoredTenant(): StoredTenant | null {
  const raw = window.localStorage.getItem(tenantStorageKey);
  return raw ? (JSON.parse(raw) as StoredTenant) : null;
}

export function storeVerticalConfig(config: VerticalConfig) {
  window.localStorage.setItem(verticalConfigStorageKey, JSON.stringify(config));
}

export function getStoredVerticalConfig(): VerticalConfig | null {
  const raw = window.localStorage.getItem(verticalConfigStorageKey);
  return raw ? (JSON.parse(raw) as VerticalConfig) : null;
}
