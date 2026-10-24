import type { NextConfig } from "next";
import { API_CACHE_CONTROL, SECURITY_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: Object.entries(SECURITY_HEADERS).map(([key, value]) => ({
          key,
          value,
        })),
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: API_CACHE_CONTROL }],
      },
    ];
  },
  allowedDevOrigins: [
    "monkeycode-ai.live",
    "*.monkeycode-ai.live",
    "**.monkeycode-ai.live",
  ],
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "argon2",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
