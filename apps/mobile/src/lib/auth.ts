import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const ACCESS_TOKEN_KEY = "bizbil.access_token";
const REFRESH_TOKEN_KEY = "bizbil.refresh_token";
const BIOMETRIC_ENABLED_KEY = "bizbil.biometric_enabled";

export async function storeTokens(access: string, refresh: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

export async function getAuthHeader(): Promise<string | null> {
  const token = await getAccessToken();
  return token ? `Bearer ${token}` : null;
}

export async function isBiometricAvailable(): Promise<boolean> {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return compatible && enrolled;
}

export async function authenticateWithBiometric(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock BizBil",
    fallbackLabel: "Use password",
    cancelLabel: "Cancel",
  });
  return result.success;
}

export async function enableBiometric(): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "true");
}

export async function isBiometricEnabled(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
  return val === "true";
}
