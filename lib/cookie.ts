import "server-only";

import type { CookieOptions } from "@/lib/session";

export function getCookie(
  cookieHeader: string | null,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator);
    if (key === name) {
      return decodeCookieValue(trimmed.slice(separator + 1));
    }
  }

  return undefined;
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  const segments = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    "SameSite=Lax",
  ];

  if (options.httpOnly) {
    segments.push("HttpOnly");
  }
  if (options.secure) {
    segments.push("Secure");
  }

  return segments.join("; ");
}

export function applySetCookies(
  headers: Headers,
  cookies: readonly string[],
): void {
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
}

export function isSecureCookieEnvironment(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv === "production";
}

function decodeCookieValue(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
