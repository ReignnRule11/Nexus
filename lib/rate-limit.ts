import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import { getPrismaClient } from "@/lib/db";
import { loadEnv, requireAuthSecret, type EnvSource } from "@/lib/env";
import { HttpError, isMissingConfigError } from "@/lib/http-error";

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export type RateLimitConsumeInput = {
  scope: string;
  subject: string;
  limit: number;
  windowMs: number;
  now?: number;
};

export type RateLimiter = {
  consume(input: RateLimitConsumeInput): Promise<RateLimitDecision>;
};

const MAX_SCOPE_LENGTH = 64;
const SUBJECT_HASH_LENGTH = 64;

let testOverride: RateLimiter | undefined;

export function setRateLimiterForTests(limiter: RateLimiter | undefined): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Test rate limiter overrides are only available when NODE_ENV=test.");
  }
  testOverride = limiter;
}

export function createMemoryRateLimiter(options?: {
  now?: () => number;
}): RateLimiter {
  const buckets = new Map<string, { windowStart: number; count: number }>();
  return {
    async consume(input) {
      const now = options?.now?.() ?? input.now ?? Date.now();
      const windowStart = Math.floor(now / input.windowMs) * input.windowMs;
      const key = `${input.scope}\0${input.subject}\0${windowStart}`;
      const current = buckets.get(key);
      const count = (current?.count ?? 0) + 1;
      buckets.set(key, { windowStart, count });
      if (count > input.limit) {
        return {
          allowed: false,
          retryAfterSeconds: retryAfterSeconds(windowStart, input.windowMs, now),
        };
      }
      return { allowed: true };
    },
  };
}

export function hashRateLimitSubject(
  scope: string,
  subject: string,
  secret: string = requireAuthSecret(),
): string {
  return createHmac("sha256", secret)
    .update(scope)
    .update("\0")
    .update(subject)
    .digest("hex");
}

export function assertRateLimitEnvironment(source: EnvSource = process.env): void {
  const env = loadEnv(source);
  if (env.nodeEnv !== "production") {
    return;
  }
  if (env.trustProxy !== true) {
    throw new Error(
      "Missing required configuration: TRUST_PROXY. Production abuse protection requires a trusted reverse proxy. Do not use fake credentials.",
    );
  }
  if (env.trustedProxyHops === undefined) {
    throw new Error(
      "Missing required configuration: TRUSTED_PROXY_HOPS. Set a positive hop count for the trusted reverse proxy. Do not use fake credentials.",
    );
  }
  if (!env.databaseUrl) {
    throw new Error(
      "Missing required configuration: DATABASE_URL. PostgreSQL access is unavailable until a connection string is provided. Do not use fake credentials.",
    );
  }
}

function retryAfterSeconds(windowStart: number, windowMs: number, now: number): number {
  return Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
}

const postgresRateLimiter: RateLimiter = {
  async consume(input) {
    if (input.scope.length === 0 || input.scope.length > MAX_SCOPE_LENGTH) {
      throw new HttpError(500, "internal", "Something went wrong.");
    }
    const now = input.now ?? Date.now();
    const windowStart = new Date(Math.floor(now / input.windowMs) * input.windowMs);
    const subjectHash = hashRateLimitSubject(input.scope, input.subject);
    if (subjectHash.length !== SUBJECT_HASH_LENGTH) {
      throw new HttpError(500, "internal", "Something went wrong.");
    }

    try {
      const prisma = getPrismaClient();
      const rows = await prisma.$queryRaw<Array<{ count: number | bigint }>>`
        INSERT INTO rate_limit_buckets (id, scope, subject_hash, window_start, count, updated_at)
        VALUES (${randomUUID()}::uuid, ${input.scope}, ${subjectHash}, ${windowStart}, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (scope, subject_hash, window_start)
        DO UPDATE SET
          count = rate_limit_buckets.count + 1,
          updated_at = CURRENT_TIMESTAMP
        RETURNING count
      `;
      const count = Number(rows[0]?.count);
      if (!Number.isInteger(count) || count < 1) {
        throw new Error("rate limit increment returned no count");
      }
      if (count > input.limit) {
        return {
          allowed: false,
          retryAfterSeconds: retryAfterSeconds(windowStart.getTime(), input.windowMs, now),
        };
      }
      return { allowed: true };
    } catch (error) {
      if (error instanceof HttpError || isMissingConfigError(error)) {
        throw error;
      }
      throw new HttpError(
        503,
        "rate_limit_unavailable",
        "Abuse protection is unavailable.",
      );
    }
  },
};

function getRateLimiter(): RateLimiter {
  if (process.env.NODE_ENV === "test" && testOverride) {
    return testOverride;
  }
  return postgresRateLimiter;
}

export async function consumeRateLimit(
  input: RateLimitConsumeInput,
): Promise<RateLimitDecision> {
  assertRateLimitEnvironment();
  try {
    return await getRateLimiter().consume(input);
  } catch (error) {
    if (error instanceof HttpError || isMissingConfigError(error)) {
      throw error;
    }
    throw new HttpError(
      503,
      "rate_limit_unavailable",
      "Abuse protection is unavailable.",
    );
  }
}

export async function enforceRateLimit(input: RateLimitConsumeInput): Promise<void> {
  const decision = await consumeRateLimit(input);
  if (!decision.allowed) {
    throw new HttpError(
      429,
      "rate_limited",
      "Too many requests. Try again later.",
      undefined,
      decision.retryAfterSeconds,
    );
  }
}
