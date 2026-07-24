import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  customWorkerDir: "worker",
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
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };

    return config;
  },
};

export default withPWA(nextConfig);
