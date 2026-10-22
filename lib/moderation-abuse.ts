export const MODERATION_ABUSE_PROTECTION_MODE = "disabled" as const;

export const MODERATION_ABUSE_PROTECTION_NOTE =
  "Report spam is constrained by duplicate-active unique indexes, bounded input, and CSRF. No in-memory or distributed rate limiter is enforced. Do not treat this as production rate limiting. Redis is not introduced for this purpose.";

export type ModerationRateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export type ModerationAbuseLimiter = {
  check(key: string): ModerationRateLimitDecision;
};

export function createDisabledModerationAbuseLimiter(): ModerationAbuseLimiter {
  return {
    check: () => ({ allowed: true }),
  };
}
