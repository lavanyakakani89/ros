import type { StoredAuthSession, StoredTenant, VerticalConfig } from "@bizbil/shared";

export type { StoredAuthSession, StoredTenant, StoredUser, UserRole, VerticalConfig } from "@bizbil/shared";

import { clearStoredImpersonation } from "@/lib/impersonation";

const authStorageKey = "bizbil.auth";
const verticalConfigStorageKey = "bizbil.verticalConfig";
const tenantStorageKey = "bizbil.tenant";
let authSessionMemory: StoredAuthSession | null = null;
let tenantMemory: StoredTenant | null = null;
let verticalConfigMemory: VerticalConfig | null = null;

export function storeAuthSession(input: StoredAuthSession) {
  const safeSession = toSafeAuthSession(input);
  authSessionMemory = safeSession;
  window.localStorage.setItem(authStorageKey, JSON.stringify(safeSession));
}

export function hasStoredAuthSession(): boolean {
  const raw = window.localStorage.getItem(authStorageKey);
  return Boolean(raw);
}

export function getStoredAuthSession(): StoredAuthSession | null {
  if (authSessionMemory) {
    return authSessionMemory;
  }

  const raw = window.localStorage.getItem(authStorageKey);
  return raw ? toSafeAuthSession(JSON.parse(raw) as StoredAuthSession) : null;
}

export function clearStoredSession() {
  authSessionMemory = null;
  tenantMemory = null;
  verticalConfigMemory = null;
  window.localStorage.removeItem(authStorageKey);
  window.localStorage.removeItem(verticalConfigStorageKey);
  window.localStorage.removeItem(tenantStorageKey);
  clearStoredImpersonation();
}

export function storeTenant(tenant: StoredTenant) {
  tenantMemory = tenant;
  window.localStorage.removeItem(tenantStorageKey);
}

export function getStoredTenant(): StoredTenant | null {
  return tenantMemory;
}

export function storeVerticalConfig(config: VerticalConfig) {
  verticalConfigMemory = config;
  window.localStorage.removeItem(verticalConfigStorageKey);
}

export function getStoredVerticalConfig(): VerticalConfig | null {
  return verticalConfigMemory;
}

function toSafeAuthSession(input: StoredAuthSession): StoredAuthSession {
  if (!input.user) {
    return {};
  }

  const user = Object.fromEntries(
    Object.entries({
      id: input.user.id,
      name: input.user.name,
      email: input.user.email,
      role: input.user.role,
    }).filter(([, value]) => value !== undefined),
  ) as NonNullable<StoredAuthSession["user"]>;

  return {
    user,
  };
}
