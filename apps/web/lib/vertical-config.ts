import type { StoredAuthSession, StoredTenant, VerticalConfig } from "@bizbil/shared";

export type { StoredAuthSession, StoredTenant, StoredUser, UserRole, VerticalConfig } from "@bizbil/shared";

import { clearStoredImpersonation } from "@/lib/impersonation";

const authStorageKey = "bizbil.auth";
const verticalConfigStorageKey = "bizbil.verticalConfig";
const tenantStorageKey = "bizbil.tenant";
let authSessionMemory: StoredAuthSession | null = null;
let tenantMemory: StoredTenant | null = null;
let verticalConfigMemory: VerticalConfig | null = null;

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function storeAuthSession(input: StoredAuthSession) {
  const safeSession = toSafeAuthSession(input);
  authSessionMemory = safeSession;
  getStorage()?.setItem(authStorageKey, JSON.stringify(safeSession));
}

export function hasStoredAuthSession(): boolean {
  if (authSessionMemory) {
    return true;
  }

  const raw = getStorage()?.getItem(authStorageKey);
  return Boolean(raw);
}

export function getStoredAuthSession(): StoredAuthSession | null {
  if (authSessionMemory) {
    return authSessionMemory;
  }

  const raw = getStorage()?.getItem(authStorageKey);
  if (!raw) {
    return null;
  }

  try {
    return toSafeAuthSession(JSON.parse(raw) as StoredAuthSession);
  } catch {
    return null;
  }
}

export function clearStoredSession() {
  authSessionMemory = null;
  tenantMemory = null;
  verticalConfigMemory = null;
  const storage = getStorage();
  storage?.removeItem(authStorageKey);
  storage?.removeItem(verticalConfigStorageKey);
  storage?.removeItem(tenantStorageKey);
  clearStoredImpersonation();
}

export function storeTenant(tenant: StoredTenant) {
  tenantMemory = tenant;
  getStorage()?.removeItem(tenantStorageKey);
}

export function getStoredTenant(): StoredTenant | null {
  return tenantMemory;
}

export function storeVerticalConfig(config: VerticalConfig) {
  verticalConfigMemory = config;
  getStorage()?.removeItem(verticalConfigStorageKey);
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
