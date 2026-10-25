import { afterEach, describe, expect, it } from "vitest";
import { POST as register } from "@/app/api/auth/register/route";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import {
  AUTH_ABUSE_PROTECTION_MODE,
  AUTH_RATE_LIMITS,
} from "@/lib/auth-abuse";
import {
  clientIdentitySubject,
  clientIpFromForwardedFor,
  resolveClientIdentity,
  TEST_CLIENT_ID_HEADER,
} from "@/lib/client-identity";
import { HttpError } from "@/lib/http-error";
import {
  assertRateLimitEnvironment,
  consumeRateLimit,
  createMemoryRateLimiter,
  enforceRateLimit,
  hashRateLimitSubject,
  setRateLimiterForTests,
} from "@/lib/rate-limit";

const SECRET = "unit-test-auth-secret-not-for-production";

describe("rate limit identity", () => {
  it("selects the client IP from the trusted hop, not the leftmost spoofed address", () => {
    expect(
      clientIpFromForwardedFor("203.0.113.1, 198.51.100.2, 192.0.2.1", 1),
    ).toBe("192.0.2.1");
    expect(
      clientIpFromForwardedFor("203.0.113.1, 198.51.100.2, 192.0.2.1", 2),
    ).toBe("198.51.100.2");
    expect(clientIpFromForwardedFor("203.0.113.1", 2)).toBeUndefined();
  });

  it("ignores untrusted forwarding headers when TRUST_PROXY is unset", () => {
    const identity = resolveClientIdentity(
      new Request("http://localhost/api/auth/login", {
        headers: { "x-forwarded-for": "203.0.113.9" },
      }),
      { NODE_ENV: "development" },
    );
    expect(identity).toEqual({ kind: "unproxied", value: "local" });
    expect(clientIdentitySubject(identity)).toBe("unproxied:local");
  });

  it("fails closed in production without a trusted proxy configuration", () => {
    expect(() =>
      assertRateLimitEnvironment({ NODE_ENV: "production" }),
    ).toThrow(/TRUST_PROXY/);
    expect(() =>
      resolveClientIdentity(new Request("http://localhost/api/auth/login"), {
        NODE_ENV: "production",
        TRUST_PROXY: "true",
      }),
    ).toThrow(/TRUSTED_PROXY_HOPS/);
  });

  it("hashes subjects without embedding the raw identifier", () => {
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SECRET;
    try {
      const hashed = hashRateLimitSubject("auth:login", "ip:192.0.2.1");
      expect(hashed).toHaveLength(64);
      expect(hashed).not.toContain("192.0.2.1");
      expect(hashRateLimitSubject("auth:login", "ip:192.0.2.2")).not.toBe(hashed);
    } finally {
      if (previous === undefined) {
        delete process.env.AUTH_SECRET;
      } else {
        process.env.AUTH_SECRET = previous;
      }
    }
  });
});

describe("in-memory rate limiter", () => {
  it("allows requests at the limit and rejects the next with retry-after", async () => {
    const now = 1_000_000;
    const limiter = createMemoryRateLimiter({ now: () => now });
    const input = {
      scope: "auth:login",
      subject: "test:one",
      limit: 2,
      windowMs: 60_000,
    };

    expect(await limiter.consume(input)).toEqual({ allowed: true });
    expect(await limiter.consume(input)).toEqual({ allowed: true });
    expect(await limiter.consume(input)).toEqual({
      allowed: false,
      retryAfterSeconds: 20,
    });
  });

  it("resets after the window expires", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter({ now: () => now });
    const input = {
      scope: "auth:register",
      subject: "test:window",
      limit: 1,
      windowMs: 1_000,
    };

    expect(await limiter.consume(input)).toEqual({ allowed: true });
    expect((await limiter.consume(input)).allowed).toBe(false);
    now = 1_000;
    expect(await limiter.consume(input)).toEqual({ allowed: true });
  });

  it("enforces concurrently without exceeding the budget", async () => {
    const limiter = createMemoryRateLimiter();
    const input = {
      scope: "ai:agent",
      subject: "user:concurrent",
      limit: 5,
      windowMs: 60_000,
    };
    const results = await Promise.all(
      Array.from({ length: 12 }, () => limiter.consume(input)),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed)).toHaveLength(7);
  });
});

describe("HTTP rate limit responses", () => {
  afterEach(() => {
    setRateLimiterForTests(undefined);
  });

  it("returns 429 and Retry-After when the limiter rejects", async () => {
    process.env.AUTH_SECRET = SECRET;
    setRateLimiterForTests({
      async consume() {
        return { allowed: false, retryAfterSeconds: 42 };
      },
    });

    const csrf = await getCsrf(new Request("http://localhost/api/auth/csrf"));
    const token = ((await csrf.json()) as { csrfToken: string }).csrfToken;
    const cookie = csrf.headers.get("set-cookie") ?? "";
    const response = await register(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "x-csrf-token": token,
          cookie,
          [TEST_CLIENT_ID_HEADER]: "limited-client",
        },
        body: JSON.stringify({
          email: "ada@example.test",
          password: "correct-horse-battery",
          username: "ada_lovelace",
          displayName: "Ada Lovelace",
        }),
      }),
    );
    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(429);
    expect(body.error.code).toBe("rate_limited");
    expect(response.headers.get("retry-after")).toBe("42");
  });

  it("fails closed when the limiter backend is unavailable", async () => {
    process.env.AUTH_SECRET = SECRET;
    setRateLimiterForTests({
      async consume() {
        throw new Error("backend down");
      },
    });

    await expect(
      enforceRateLimit({
        scope: AUTH_RATE_LIMITS.login.scope,
        subject: "test:outage",
        limit: AUTH_RATE_LIMITS.login.limit,
        windowMs: AUTH_RATE_LIMITS.login.windowMs,
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "rate_limit_unavailable",
    });
    expect(AUTH_ABUSE_PROTECTION_MODE).toBe("postgres");
  });

  it("does not silently allow protected operations when configuration is missing", async () => {
    const previous = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      await expect(
        consumeRateLimit({
          scope: "auth:login",
          subject: "test:missing-secret",
          limit: 1,
          windowMs: 1000,
        }),
      ).rejects.toThrow(/AUTH_SECRET/);
    } finally {
      if (previous === undefined) {
        delete process.env.AUTH_SECRET;
      } else {
        process.env.AUTH_SECRET = previous;
      }
    }
    expect(new HttpError(429, "rate_limited", "Too many requests.", undefined, 9).retryAfterSeconds).toBe(9);
  });
});
