export const AUTH_ABUSE_PROTECTION_MODE = "disabled" as const;

export const AUTH_ABUSE_PROTECTION_NOTE =
  "Authentication abuse protection is an interface only in this phase. No in-memory or distributed limiter is enforced. Do not treat this as production rate limiting.";

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export type AuthAbuseLimiter = {
  check(key: string): RateLimitDecision;
};

export function createDisabledAuthAbuseLimiter(): AuthAbuseLimiter {
  return {
    check: () => ({ allowed: true }),
  };
}
