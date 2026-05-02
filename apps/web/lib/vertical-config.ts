import type { VerticalConfig } from "@retailos/shared";

const authStorageKey = "retailos.auth";
const verticalConfigStorageKey = "retailos.verticalConfig";

export function storeAuthSession(input: {
  user: unknown;
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
  };
}) {
  window.localStorage.setItem(authStorageKey, JSON.stringify(input));
}

export function getAccessToken(): string | null {
  const raw = window.localStorage.getItem(authStorageKey);
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as { tokens?: { accessToken?: string } };
  return parsed.tokens?.accessToken ?? null;
}

export function storeVerticalConfig(config: VerticalConfig) {
  window.localStorage.setItem(verticalConfigStorageKey, JSON.stringify(config));
}

export function getStoredVerticalConfig(): VerticalConfig | null {
  const raw = window.localStorage.getItem(verticalConfigStorageKey);
  return raw ? (JSON.parse(raw) as VerticalConfig) : null;
}
