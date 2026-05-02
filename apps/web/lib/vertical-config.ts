import type { VerticalConfig } from "@retailos/shared";

const authStorageKey = "retailos.auth";
const verticalConfigStorageKey = "retailos.verticalConfig";

export function storeAuthSession(input: {
  user: unknown;
}) {
  window.localStorage.setItem(authStorageKey, JSON.stringify(input));
}

export function hasStoredAuthSession(): boolean {
  const raw = window.localStorage.getItem(authStorageKey);
  return Boolean(raw);
}

export function storeVerticalConfig(config: VerticalConfig) {
  window.localStorage.setItem(verticalConfigStorageKey, JSON.stringify(config));
}

export function getStoredVerticalConfig(): VerticalConfig | null {
  const raw = window.localStorage.getItem(verticalConfigStorageKey);
  return raw ? (JSON.parse(raw) as VerticalConfig) : null;
}
