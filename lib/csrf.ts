import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/session";
import { HttpError } from "@/lib/http-error";

export { CSRF_COOKIE_NAME, CSRF_HEADER_NAME };

export const CSRF_STRATEGY =
  "Synchronizer token: HMAC-signed CSRF cookie compared to the x-csrf-token header, plus fail-closed same-origin checks that require a matching Origin. AUTH_SECRET signs tokens. This is not a substitute for SameSite cookies.";

export function createCsrfToken(secret: string): string {
  const nonce = randomBytes(32).toString("base64url");
  return `${nonce}.${signCsrfNonce(secret, nonce)}`;
}

export function isValidCsrfToken(secret: string, token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return false;
  }

  const nonce = parts[0];
  const signature = parts[1];
  if (!nonce || !signature) {
    return false;
  }

  const expected = signCsrfNonce(secret, nonce);
  return timingSafeEqualString(signature, expected);
}

export function readCsrfHeader(request: Request): string | undefined {
  const value = request.headers.get(CSRF_HEADER_NAME);
  if (!value || value.trim() === "") {
    return undefined;
  }
  return value;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new HttpError(403, "csrf", "Request rejected.");
  }

  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    throw new HttpError(403, "csrf", "Request rejected.");
  }

  if (origin !== requestOrigin) {
    throw new HttpError(403, "csrf", "Request rejected.");
  }
}

export function assertCsrf(
  secret: string,
  cookieToken: string | undefined,
  headerToken: string | undefined,
): void {
  if (!cookieToken || !headerToken) {
    throw new HttpError(403, "csrf", "Request rejected.");
  }

  if (!timingSafeEqualString(cookieToken, headerToken)) {
    throw new HttpError(403, "csrf", "Request rejected.");
  }

  if (!isValidCsrfToken(secret, cookieToken)) {
    throw new HttpError(403, "csrf", "Request rejected.");
  }
}

function signCsrfNonce(secret: string, nonce: string): string {
  return createHmac("sha256", secret).update(nonce).digest("base64url");
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
