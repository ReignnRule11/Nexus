import { describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/profile/route";
import { MAX_JSON_BODY_BYTES, readJsonObject } from "@/lib/auth-http";
import { requireAuthSecret } from "@/lib/env";
import { toErrorBody } from "@/lib/http-error";
import { AUTH_ABUSE_PROTECTION_MODE, AUTH_ABUSE_PROTECTION_NOTE } from "@/lib/auth-abuse";

describe("authentication without PostgreSQL", () => {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());

  it.skipIf(databaseConfigured)(
    "fails closed instead of switching to mock authentication",
    async () => {
      const previousSecret = process.env.AUTH_SECRET;
      process.env.AUTH_SECRET = "unit-test-auth-secret-not-for-production";

      try {
        const csrf = await getCsrf(new Request("http://localhost/api/auth/csrf"));
        expect(csrf.status).toBe(200);

        const token = ((await csrf.json()) as { csrfToken: string }).csrfToken;
        const cookie = csrf.headers.get("set-cookie") ?? "";
        const request = new Request("http://localhost/api/auth/register", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
            "x-csrf-token": token,
            cookie,
          },
          body: JSON.stringify({
            email: "ada@example.test",
            password: "correct-horse-battery",
            username: "ada_lovelace",
            displayName: "Ada Lovelace",
          }),
        });

        const response = await register(request);
        const body = (await response.json()) as {
          error: { code: string; message: string };
        };

        expect(response.status).toBe(503);
        expect(body.error.code).toBe("not_configured");
        expect(JSON.stringify(body)).not.toContain("postgresql://");
      } finally {
        if (previousSecret === undefined) {
          delete process.env.AUTH_SECRET;
        } else {
          process.env.AUTH_SECRET = previousSecret;
        }
      }
    },
  );

  it("maps missing AUTH_SECRET without leaking internals", () => {
    const mapped = toErrorBody(
      new Error(
        "Missing required configuration: AUTH_SECRET. Authentication is unavailable until a session secret is provided. Do not use fake credentials.",
      ),
    );

    expect(mapped.status).toBe(503);
    expect(mapped.body.error.code).toBe("not_configured");
    expect(JSON.stringify(mapped.body)).not.toContain("AUTH_SECRET");
  });

  it("documents PostgreSQL authentication rate limiting", () => {
    expect(AUTH_ABUSE_PROTECTION_MODE).toBe("postgres");
    expect(AUTH_ABUSE_PROTECTION_NOTE).toMatch(/PostgreSQL fixed-window limiter/i);
    expect(AUTH_ABUSE_PROTECTION_NOTE).toMatch(/fails closed/i);
  });

  it("rejects oversized JSON bodies", async () => {
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"pad":"${"a".repeat(MAX_JSON_BODY_BYTES)}"}`,
    });

    await expect(readJsonObject(request)).rejects.toMatchObject({
      status: 413,
      code: "payload_too_large",
    });
  });
});

describe("auth route surface", () => {
  it("exports the expected HTTP methods", () => {
    expect(typeof register).toBe("function");
    expect(typeof login).toBe("function");
    expect(typeof logout).toBe("function");
    expect(typeof me).toBe("function");
    expect(typeof getProfile).toBe("function");
    expect(typeof patchProfile).toBe("function");
    expect(typeof getCsrf).toBe("function");
    expect(() => requireAuthSecret({})).toThrow(/AUTH_SECRET/);
  });
});
