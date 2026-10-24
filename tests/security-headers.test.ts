import { describe, expect, it } from "vitest";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import nextConfig from "@/next.config";
import { SECURITY_HEADERS } from "@/lib/security-headers";

describe("HTTP security headers", () => {
  it("defines browser isolation headers in next.config", async () => {
    const configured = await nextConfig.headers?.();
    const global = configured?.find((entry) => entry.source === "/:path*");
    const keys = new Set(global?.headers.map((header) => header.key));

    expect(keys.has("Content-Security-Policy")).toBe(true);
    expect(keys.has("X-Content-Type-Options")).toBe(true);
    expect(keys.has("X-Frame-Options")).toBe(true);
    expect(keys.has("Referrer-Policy")).toBe(true);
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
  });

  it("applies security headers on JSON API responses", async () => {
    const previousSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "unit-test-auth-secret-not-for-production";
    try {
      const health = await getHealth();
      expect(health.headers.get("x-content-type-options")).toBe("nosniff");
      expect(health.headers.get("x-frame-options")).toBe("DENY");
      expect(health.headers.get("cache-control")).toBe("no-store");

      const csrf = await getCsrf(new Request("http://localhost/api/auth/csrf"));
      expect(csrf.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(csrf.headers.get("referrer-policy")).toBe("no-referrer");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.AUTH_SECRET;
      } else {
        process.env.AUTH_SECRET = previousSecret;
      }
    }
  });
});
