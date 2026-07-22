import type { VerticalConfig } from "@retailos/shared";

import { clearStoredImpersonation } from "@/lib/impersonation";

const authStorageKey = "retailos.auth";
const verticalConfigStorageKey = "retailos.verticalConfig";
const tenantStorageKey = "retailos.tenant";
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

export interface StoredAuthSession {
  user?: {
    id?: string;
    name?: string;
    email?: string;
    role?: string;
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
  getStorage()?.setItem(tenantStorageKey, JSON.stringify(tenant));
}

export function getStoredTenant(): StoredTenant | null {
  if (tenantMemory) {
    return tenantMemory;
  }

  const raw = getStorage()?.getItem(tenantStorageKey);
  if (!raw) {
    return null;
  }

  try {
    tenantMemory = toSafeTenant(JSON.parse(raw) as StoredTenant);
    return tenantMemory;
  } catch {
    return null;
  }
}

export function storeVerticalConfig(config: VerticalConfig) {
  verticalConfigMemory = config;
  getStorage()?.setItem(verticalConfigStorageKey, JSON.stringify(config));
}

export function getStoredVerticalConfig(): VerticalConfig | null {
  if (verticalConfigMemory) {
    return verticalConfigMemory;
  }

  const raw = getStorage()?.getItem(verticalConfigStorageKey);
  if (!raw) {
    return null;
  }

  try {
    verticalConfigMemory = JSON.parse(raw) as VerticalConfig;
    return verticalConfigMemory;
  } catch {
    return null;
  }
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

function toSafeTenant(input: StoredTenant): StoredTenant {
  return {
    name: input.name,
    slug: input.slug,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.gstEnabled !== undefined ? { gstEnabled: input.gstEnabled } : {}),
    ...(input.gstNumber !== undefined ? { gstNumber: input.gstNumber } : {}),
  };
}
