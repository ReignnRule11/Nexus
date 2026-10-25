import "server-only";

import {
  clientIdentitySubject,
  type ClientIdentity,
} from "@/lib/client-identity";
import { enforceRateLimit } from "@/lib/rate-limit";

export const AUTH_ABUSE_PROTECTION_MODE = "postgres" as const;

export const AUTH_ABUSE_PROTECTION_NOTE =
  "Authentication abuse protection uses a PostgreSQL fixed-window limiter. Register and login are limited per trusted-proxy client identity. Production requires TRUST_PROXY and TRUSTED_PROXY_HOPS. The limiter fails closed if PostgreSQL is unavailable. Process-local limiters are not used in production and do not protect a distributed deployment.";

export const AUTH_RATE_LIMITS = {
  register: {
    scope: "auth:register",
    limit: 20,
    windowMs: 15 * 60 * 1000,
  },
  login: {
    scope: "auth:login",
    limit: 20,
    windowMs: 15 * 60 * 1000,
  },
} as const;

export async function assertAuthAbuseLimit(
  operation: keyof typeof AUTH_RATE_LIMITS,
  client: ClientIdentity,
): Promise<void> {
  const budget = AUTH_RATE_LIMITS[operation];
  await enforceRateLimit({
    scope: budget.scope,
    subject: clientIdentitySubject(client),
    limit: budget.limit,
    windowMs: budget.windowMs,
  });
}
