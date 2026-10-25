import "server-only";

import { enforceRateLimit } from "@/lib/rate-limit";

export const MODERATION_ABUSE_PROTECTION_MODE = "postgres" as const;

export const MODERATION_ABUSE_PROTECTION_NOTE =
  "Report spam is constrained by duplicate-active unique indexes, bounded input, CSRF, and a PostgreSQL fixed-window limiter keyed by authenticated reporter id. The limiter fails closed if PostgreSQL is unavailable. Process-local limiters are not used in production and do not protect a distributed deployment. Redis is not introduced for this purpose.";

export const MODERATION_RATE_LIMITS = {
  report: {
    scope: "moderation:report",
    limit: 20,
    windowMs: 60 * 60 * 1000,
  },
} as const;

export async function assertModerationAbuseLimit(userId: string): Promise<void> {
  await enforceRateLimit({
    scope: MODERATION_RATE_LIMITS.report.scope,
    subject: `user:${userId}`,
    limit: MODERATION_RATE_LIMITS.report.limit,
    windowMs: MODERATION_RATE_LIMITS.report.windowMs,
  });
}
