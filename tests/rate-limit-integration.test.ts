import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as register } from "@/app/api/auth/register/route";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { consumeRateLimit, setRateLimiterForTests } from "@/lib/rate-limit";
import { TEST_CLIENT_ID_HEADER } from "@/lib/client-identity";
import { ensureTestAuthSecret, uniqueEmail, uniqueUsername } from "@/tests/user-fixtures";

const env = loadEnv(process.env);
const databaseUrl = env.databaseUrl;
const TEST_DATABASE_NAME = "nexus_test";
const ORIGIN = "http://localhost";

function databaseNameFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, "");
    return name || undefined;
  } catch {
    return undefined;
  }
}

const connectedDatabaseName = databaseUrl
  ? databaseNameFromUrl(databaseUrl)
  : undefined;
const canRunIntegration =
  Boolean(databaseUrl) && connectedDatabaseName === TEST_DATABASE_NAME;

function cookiePairs(response: Response): string[] {
  const getter = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  if (typeof getter === "function") {
    return getter.call(response.headers);
  }
  const header = response.headers.get("set-cookie");
  return header ? [header] : [];
}

describe.skipIf(canRunIntegration)(
  "rate limit PostgreSQL integration (blocked by environment)",
  () => {
    it("does not mutate PostgreSQL unless DATABASE_URL points at nexus_test", () => {
      expect(connectedDatabaseName === TEST_DATABASE_NAME).toBe(false);
    });
  },
);

describe.skipIf(!canRunIntegration)("rate limit PostgreSQL integration", () => {
  const createdUserIds: string[] = [];
  let prisma: ReturnType<typeof getPrismaClient>;

  beforeAll(() => {
    ensureTestAuthSecret();
    prisma = getPrismaClient();
  });

  afterEach(async () => {
    setRateLimiterForTests(undefined);
    if (!prisma) {
      return;
    }
    if (createdUserIds.length > 0) {
      const ids = [...createdUserIds];
      createdUserIds.length = 0;
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.rateLimitBucket.deleteMany({
      where: { scope: { startsWith: "test:" } },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it("increments atomically and rejects after the budget", async () => {
    const subject = `test-atomic-${Date.now()}`;
    const input = {
      scope: "test:atomic",
      subject,
      limit: 3,
      windowMs: 60_000,
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeRateLimit(input)),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect(results.filter((result) => !result.allowed)).toHaveLength(5);
    const denied = results.find((result) => !result.allowed);
    expect(denied && !denied.allowed ? denied.retryAfterSeconds : 0).toBeGreaterThan(0);
  });

  it("does not store raw client identifiers", async () => {
    await consumeRateLimit({
      scope: "test:privacy",
      subject: "ip:203.0.113.50",
      limit: 5,
      windowMs: 60_000,
    });
    const rows = await prisma.rateLimitBucket.findMany({
      where: { scope: "test:privacy" },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.50");
    expect(rows[0]?.subjectHash).toHaveLength(64);
  });

  it("returns HTTP 429 from register after the client budget", async () => {
    const csrf = await getCsrf(new Request(`${ORIGIN}/api/auth/csrf`));
    const token = ((await csrf.json()) as { csrfToken: string }).csrfToken;
    const cookies = cookiePairs(csrf);
    const clientId = `register-limit-${Date.now()}`;
    setRateLimiterForTests({
      async consume() {
        return { allowed: false, retryAfterSeconds: 17 };
      },
    });
    const response = await register(
      new Request(`${ORIGIN}/api/auth/register`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-csrf-token": token,
          cookie: cookies
            .map((entry) => entry.split(";")[0])
            .filter((part): part is string => Boolean(part))
            .join("; "),
          [TEST_CLIENT_ID_HEADER]: clientId,
        },
        body: JSON.stringify({
          email: uniqueEmail("limit"),
          password: "correct-horse-battery",
          username: uniqueUsername("limit"),
          displayName: "Limit Tester",
        }),
      }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
  });
});
