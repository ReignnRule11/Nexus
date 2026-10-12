import "server-only";

import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "nexus_session";
export const CSRF_COOKIE_NAME = "nexus_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function csrfCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function expiredSessionCookieOptions(secure: boolean): CookieOptions {
  return {
    ...sessionCookieOptions(secure),
    maxAge: 0,
  };
}

export function expiredCsrfCookieOptions(secure: boolean): CookieOptions {
  return {
    ...csrfCookieOptions(secure),
    maxAge: 0,
  };
}

export function sessionExpiryDate(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
}
