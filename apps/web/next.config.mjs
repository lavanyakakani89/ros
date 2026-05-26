import withPWAInit from "next-pwa";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
const packageRoot = (packageName) =>
  path.dirname(require.resolve(`${packageName}/package.json`));
const nextDependencyRoot = (packageName) =>
  path.dirname(nextRequire.resolve(`${packageName}/package.json`));
const packageAlias = (aliases, packageName) =>
  Object.prototype.hasOwnProperty.call(aliases, packageName)
    ? {}
    : { [packageName]: packageRoot(packageName) };

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  fallbacks: {
    document: "/offline",
  },
  register: true,
  skipWaiting: true,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      const aliases = config.resolve.alias ?? {};
      config.resolve.alias = {
        ...aliases,
        ...packageAlias(aliases, "react"),
        ...packageAlias(aliases, "react-dom"),
      };
    } else {
      config.resolve.alias = {
        ...config.resolve.alias,
        react: nextDependencyRoot("react"),
      };
    }
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };

    return config;
  },
};

export default withPWA(nextConfig);
