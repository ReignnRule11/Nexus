import "server-only";

import { randomUUID } from "node:crypto";
import { loadEnv, type EnvSource } from "@/lib/env";
import { HttpError } from "@/lib/http-error";
import { assertRateLimitEnvironment } from "@/lib/rate-limit";

export type ClientIdentity = {
  kind: "ip" | "unproxied" | "test";
  value: string;
};

export const TEST_CLIENT_ID_HEADER = "x-test-client-id";

const MAX_IDENTITY_LENGTH = 128;

function parseForwardedAddresses(header: string): string[] {
  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= MAX_IDENTITY_LENGTH);
}

export function clientIpFromForwardedFor(
  forwardedFor: string | null,
  hops: number,
): string | undefined {
  if (!forwardedFor || !Number.isInteger(hops) || hops < 1) {
    return undefined;
  }
  const parts = parseForwardedAddresses(forwardedFor);
  if (parts.length < hops) {
    return undefined;
  }
  return parts[parts.length - hops];
}

export function clientIdentitySubject(identity: ClientIdentity): string {
  return `${identity.kind}:${identity.value}`;
}

export function resolveClientIdentity(
  request: Request,
  source: EnvSource = process.env,
): ClientIdentity {
  assertRateLimitEnvironment(source);
  const env = loadEnv(source);

  if (env.nodeEnv === "test") {
    const testId = request.headers.get(TEST_CLIENT_ID_HEADER)?.trim();
    if (testId && testId.length <= MAX_IDENTITY_LENGTH) {
      return { kind: "test", value: testId };
    }
    return { kind: "test", value: randomUUID() };
  }

  if (env.trustProxy === true) {
    if (env.trustedProxyHops === undefined) {
      throw new Error(
        "Missing required configuration: TRUSTED_PROXY_HOPS. Set a positive hop count for the trusted reverse proxy. Do not use fake credentials.",
      );
    }
    const ip = clientIpFromForwardedFor(
      request.headers.get("x-forwarded-for"),
      env.trustedProxyHops,
    );
    if (!ip) {
      throw new HttpError(
        503,
        "not_configured",
        "Client identity is unavailable.",
      );
    }
    return { kind: "ip", value: ip };
  }

  if (env.nodeEnv === "production") {
    throw new Error(
      "Missing required configuration: TRUST_PROXY. Production abuse protection requires a trusted reverse proxy. Do not use fake credentials.",
    );
  }

  return { kind: "unproxied", value: "local" };
}
