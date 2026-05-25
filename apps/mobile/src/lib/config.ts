import Constants from "expo-constants";

declare const process: { env: Record<string, string | undefined> };

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://ros.sivsanoils.in/api";
