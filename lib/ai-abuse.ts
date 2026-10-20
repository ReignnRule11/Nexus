export const AI_ABUSE_PROTECTION_MODE = "disabled" as const;

export const AI_ABUSE_PROTECTION_NOTE =
  "AI abuse protection is an interface only in this phase. No in-memory or distributed limiter is enforced. Do not treat this as production rate limiting. Redis is not introduced for this purpose.";

export type AiRateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export type AiAbuseLimiter = {
  check(key: string): AiRateLimitDecision;
};

export function createDisabledAiAbuseLimiter(): AiAbuseLimiter {
  return {
    check: () => ({ allowed: true }),
  };
}
