import { describe, expect, it } from "vitest";
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  csrfCookieOptions,
  generateSessionToken,
  hashSessionToken,
  sessionCookieOptions,
} from "@/lib/session";
import { serializeCookie } from "@/lib/cookie";

describe("session tokens", () => {
  it("generates unpredictable tokens and stores only hashes", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);

    expect(token).not.toBe(hash);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSessionToken()).not.toBe(token);
  });

  it("issues HttpOnly session cookies with production Secure and SameSite", () => {
    const production = serializeCookie(
      SESSION_COOKIE_NAME,
      "raw-token",
      sessionCookieOptions(true),
    );
    const development = serializeCookie(
      SESSION_COOKIE_NAME,
      "raw-token",
      sessionCookieOptions(false),
    );

    expect(production).toContain("HttpOnly");
    expect(production).toContain("Secure");
    expect(production).toContain("SameSite=Lax");
    expect(production).toContain("Path=/");
    expect(production).toContain("Max-Age=");
    expect(development).toContain("HttpOnly");
    expect(development).not.toContain("Secure");
  });

  it("issues CSRF cookies without exposing the name to JavaScript as a session token", () => {
    const cookie = serializeCookie(
      CSRF_COOKIE_NAME,
      "csrf-token",
      csrfCookieOptions(true),
    );

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(CSRF_COOKIE_NAME).not.toBe(SESSION_COOKIE_NAME);
  });
});
