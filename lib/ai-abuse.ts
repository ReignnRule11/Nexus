import "server-only";

import { enforceRateLimit } from "@/lib/rate-limit";

export const AI_ABUSE_PROTECTION_MODE = "postgres" as const;

export const AI_ABUSE_PROTECTION_NOTE =
  "AI abuse protection uses a PostgreSQL fixed-window limiter keyed by authenticated user id. The limiter fails closed if PostgreSQL is unavailable. Process-local limiters are not used in production and do not protect a distributed deployment. Redis is not introduced for this purpose.";

export const AI_RATE_LIMITS = {
  agent: {
    scope: "ai:agent",
    limit: 30,
    windowMs: 60 * 60 * 1000,
  },
} as const;

export async function assertAiAbuseLimit(userId: string): Promise<void> {
  await enforceRateLimit({
    scope: AI_RATE_LIMITS.agent.scope,
    subject: `user:${userId}`,
    limit: AI_RATE_LIMITS.agent.limit,
    windowMs: AI_RATE_LIMITS.agent.windowMs,
  });
}
