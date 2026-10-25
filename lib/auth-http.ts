import "server-only";

import { requireAuthSecret } from "@/lib/env";
import { applySetCookies, getCookie, isSecureCookieEnvironment, serializeCookie } from "@/lib/cookie";
import { assertCsrf, assertSameOrigin, readCsrfHeader } from "@/lib/csrf";
import { HttpError, isHttpError, toErrorBody } from "@/lib/http-error";
import { applySecurityHeaders } from "@/lib/security-headers";
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

export const MAX_JSON_BODY_BYTES = 64 * 1024;

export function jsonResponse(
  body: unknown,
  status = 200,
  cookies: string[] = [],
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  applySecurityHeaders(headers);
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }
  applySetCookies(headers, cookies);
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(error: unknown): Response {
  const mapped = toErrorBody(error);
  const extraHeaders: Record<string, string> = {};
  if (isHttpError(error) && error.retryAfterSeconds !== undefined) {
    extraHeaders["Retry-After"] = String(error.retryAfterSeconds);
  }
  return jsonResponse(mapped.body, mapped.status, [], extraHeaders);
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

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "payload_too_large", "Request is too large.");
    }
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "Request is too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}
