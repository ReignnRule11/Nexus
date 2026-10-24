import { describe, expect, it } from "vitest";
import {
  CSRF_STRATEGY,
  assertCsrf,
  assertSameOrigin,
  createCsrfToken,
  isValidCsrfToken,
} from "@/lib/csrf";
import { HttpError } from "@/lib/http-error";

const SECRET = "unit-test-csrf-secret-not-for-production";

describe("csrf protection", () => {
  it("creates HMAC-signed tokens that verify with the auth secret", () => {
    const token = createCsrfToken(SECRET);

    expect(isValidCsrfToken(SECRET, token)).toBe(true);
    expect(isValidCsrfToken("other-secret-value-not-used", token)).toBe(false);
    expect(isValidCsrfToken(SECRET, `${token}x`)).toBe(false);
  });

  it("requires matching cookie and header tokens", () => {
    const token = createCsrfToken(SECRET);

    expect(() => assertCsrf(SECRET, token, token)).not.toThrow();
    expect(() => assertCsrf(SECRET, token, undefined)).toThrow(HttpError);
    expect(() => assertCsrf(SECRET, token, createCsrfToken(SECRET))).toThrow(
      HttpError,
    );
  });

  it("rejects cross-origin state-changing requests", () => {
    const request = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });

    expect(() => assertSameOrigin(request)).toThrow(HttpError);
  });

  it("allows same-origin requests", () => {
    const request = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });

    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("rejects state-changing requests without an Origin header", () => {
    const request = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
    });

    expect(() => assertSameOrigin(request)).toThrow(HttpError);
  });

  it("documents the synchronizer-token CSRF strategy", () => {
    expect(CSRF_STRATEGY).toMatch(/HMAC-signed CSRF cookie/);
    expect(CSRF_STRATEGY).toMatch(/x-csrf-token/);
  });
});
