import "server-only";

import { requireAuthSecret } from "@/lib/env";
import { applySetCookies, getCookie, isSecureCookieEnvironment, serializeCookie } from "@/lib/cookie";
import { assertCsrf, assertSameOrigin, readCsrfHeader } from "@/lib/csrf";
import { HttpError, toErrorBody } from "@/lib/http-error";
import type { IssuedSession } from "@/lib/auth";
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  csrfCookieOptions,
  expiredCsrfCookieOptions,
  expiredSessionCookieOptions,
  sessionCookieOptions,
} from "@/lib/session";

export function readSessionToken(request: Request): string | undefined {
  return getCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
}

export function readCsrfCookie(request: Request): string | undefined {
  return getCookie(request.headers.get("cookie"), CSRF_COOKIE_NAME);
}

export function protectMutation(request: Request): void {
  requireAuthSecret();
  assertSameOrigin(request);
  assertCsrf(requireAuthSecret(), readCsrfCookie(request), readCsrfHeader(request));
}

export function jsonResponse(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json" });
  applySetCookies(headers, cookies);
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(error: unknown): Response {
  const mapped = toErrorBody(error);
  return jsonResponse(mapped.body, mapped.status);
}

export function sessionCookies(session: IssuedSession): string[] {
  const secure = isSecureCookieEnvironment();
  return [
    serializeCookie(
      SESSION_COOKIE_NAME,
      session.token,
      sessionCookieOptions(secure),
    ),
    serializeCookie(
      CSRF_COOKIE_NAME,
      session.csrfToken,
      csrfCookieOptions(secure),
    ),
  ];
}

export function csrfSetCookie(token: string): string {
  return serializeCookie(
    CSRF_COOKIE_NAME,
    token,
    csrfCookieOptions(isSecureCookieEnvironment()),
  );
}

export function clearedAuthCookies(): string[] {
  const secure = isSecureCookieEnvironment();
  return [
    serializeCookie(SESSION_COOKIE_NAME, "", expiredSessionCookieOptions(secure)),
    serializeCookie(CSRF_COOKIE_NAME, "", expiredCsrfCookieOptions(secure)),
  ];
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "JSON body required.");
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}
