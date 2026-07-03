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

function readStoredJson(key: string): object | string | number | boolean | null {
  const storage = getStorage();
  const raw = storage?.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as object | string | number | boolean | null;
    return parsed;
  } catch {
    storage?.removeItem(key);
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

  return Boolean(readStoredJson(authStorageKey));
}

export function getStoredAuthSession(): StoredAuthSession | null {
  if (authSessionMemory) {
    return authSessionMemory;
  }

  const storedSession = readStoredJson(authStorageKey) as StoredAuthSession | null;
  if (!storedSession) {
    return null;
  }

  authSessionMemory = toSafeAuthSession(storedSession);
  return authSessionMemory;
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
  getStorage()?.setItem(tenantStorageKey, JSON.stringify(tenant));
}

export function getStoredTenant(): StoredTenant | null {
  if (tenantMemory) {
    return tenantMemory;
  }

  const storedTenant = readStoredJson(tenantStorageKey) as StoredTenant | null;
  if (!storedTenant?.name) {
    return null;
  }

  tenantMemory = storedTenant;
  return tenantMemory;
}

export function storeVerticalConfig(config: VerticalConfig) {
  verticalConfigMemory = config;
  getStorage()?.setItem(verticalConfigStorageKey, JSON.stringify(config));
}

export function getStoredVerticalConfig(): VerticalConfig | null {
  if (verticalConfigMemory) {
    return verticalConfigMemory;
  }

  verticalConfigMemory = readStoredJson(verticalConfigStorageKey) as VerticalConfig | null;
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
