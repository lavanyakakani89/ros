import { useImpersonationStore } from "@bizbil/shared";

export function getImpersonationHeaderToken(): string | null {
  const store = useImpersonationStore.getState();
  if (!store.impersonation?.token) return null;
  return `${store.impersonation.sessionId}.${store.impersonation.token}`;
}
