/// <reference path="../zustand-shim.d.ts" />

import { create } from "zustand";

export interface StoredImpersonation {
  sessionId: string;
  token?: string;
  tenantName?: string;
  accessLevel: "READ_ONLY" | "WRITE";
  reason: string | null;
  expiresAt: string;
  superAdminId?: string;
  superAdminName?: string;
  superAdminEmail: string;
}

interface ImpersonationStore {
  impersonation: StoredImpersonation | null;
  setImpersonation: (input: StoredImpersonation | null) => void;
  clearImpersonation: () => void;
}

export const useImpersonationStore = create<ImpersonationStore>((set, get) => ({
  impersonation: null,
  setImpersonation: (input) => {
    if (!input) {
      set({ impersonation: null });
      return;
    }

    set({
      impersonation: {
        ...get().impersonation,
        ...input,
      },
    });
  },
  clearImpersonation: () => set({ impersonation: null }),
}));

export function storeImpersonation(input: StoredImpersonation | null) {
  useImpersonationStore.getState().setImpersonation(input);
}

export function getStoredImpersonation(): StoredImpersonation | null {
  return useImpersonationStore.getState().impersonation;
}

export function getImpersonation(): StoredImpersonation | null {
  return getStoredImpersonation();
}

export function clearStoredImpersonation() {
  useImpersonationStore.getState().clearImpersonation();
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

export function getImpersonationHeaderToken(): string | null {
  const impersonation = getStoredImpersonation();
  if (!impersonation?.sessionId || !impersonation.token) {
    return null;
  }

  return impersonation.token.includes(".") ? impersonation.token : `${impersonation.sessionId}.${impersonation.token}`;
}
