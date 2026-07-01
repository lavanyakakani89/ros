import { existsSync } from "fs";
import { join } from "path";
import type { ExpoConfig } from "expo/config";

declare const process: {
  cwd: () => string;
  env: Record<string, string | undefined>;
};

const appEnv = process.env.APP_ENV ?? "development";
const hasGoogleServices = existsSync(join(process.cwd(), "google-services.json"));

const apiUrls: Record<string, string> = {
  production: "https://ros.sivsanoils.in/api",
  preview: "https://staging-ros.sivsanoils.in/api",
  development: "http://localhost:4000/api",
};

const plugins: NonNullable<ExpoConfig["plugins"]> = [
  "expo-router",
  "expo-secure-store",
  "expo-local-authentication",
  ["expo-camera", { cameraPermission: "Allow BizBil to use the camera for barcode scanning and delivery photos." }],
  ["expo-location", { locationWhenInUsePermission: "Allow BizBil to capture your location when marking deliveries." }],
  ...(hasGoogleServices ? [["expo-notifications", { icon: "./assets/notification-icon.png", color: "#0F6E56" }] as [string, Record<string, string>]] : []),
];

const config: ExpoConfig = {
  name: "BizBil",
  slug: "bizbil",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#0F6E56",
  },
  scheme: "bizbil",
  extra: {
    appEnv,
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? apiUrls[appEnv] ?? apiUrls.development,
    eas: { projectId: process.env.EAS_PROJECT_ID ?? "d1ce757f-7cab-47cb-bcb2-5eb0eb8b5175" },
  },
  android: {
    package: "in.bizbil.app",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0F6E56",
    },
    ...(hasGoogleServices ? { googleServicesFile: "./google-services.json" } : {}),
    permissions: [
      "CAMERA",
      "ACCESS_FINE_LOCATION",
      "BLUETOOTH",
      "BLUETOOTH_CONNECT",
      "BLUETOOTH_SCAN",
      "VIBRATE",
    ],
  },
  plugins,
};

export default config;
