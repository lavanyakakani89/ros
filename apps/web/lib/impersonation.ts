const impersonationStorageKey = "retailos.impersonation";

export interface StoredImpersonation {
  sessionId: string;
  accessLevel: "READ_ONLY" | "WRITE";
  reason: string | null;
  expiresAt: string;
  superAdminId: string;
  superAdminName: string;
  superAdminEmail: string;
}

export function storeImpersonation(input: StoredImpersonation | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!input) {
    window.localStorage.removeItem(impersonationStorageKey);
    return;
  }

  window.localStorage.setItem(impersonationStorageKey, JSON.stringify(input));
}

export function getStoredImpersonation(): StoredImpersonation | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(impersonationStorageKey);
  return raw ? (JSON.parse(raw) as StoredImpersonation) : null;
}

export function clearStoredImpersonation() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(impersonationStorageKey);
}

export function isImpersonationReadOnly(): boolean {
  return getStoredImpersonation()?.accessLevel === "READ_ONLY";
}

export function ensureWriteAllowedDuringImpersonation() {
  if (isImpersonationReadOnly()) {
    throw new Error("Write actions are not permitted in read-only support mode");
  }
}

export function isImpersonated(): boolean {
  return Boolean(getStoredImpersonation());
}
