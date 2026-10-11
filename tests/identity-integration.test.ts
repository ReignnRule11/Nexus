import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { getPrismaClient } from "@/lib/db";
import { getDatabaseHealth } from "@/lib/db-health";
import { loadEnv } from "@/lib/env";
import { normalizeUsername } from "@/lib/identity";

const env = loadEnv(process.env);
const databaseUrl = env.databaseUrl;
const TEST_DATABASE_NAME = "nexus_test";

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

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe.skipIf(canRunIntegration)(
  "identity PostgreSQL integration (blocked by environment)",
  () => {
    it("does not mutate PostgreSQL unless DATABASE_URL points at nexus_test", () => {
      expect(connectedDatabaseName === TEST_DATABASE_NAME).toBe(false);
    });
  },
);

describe.skipIf(!canRunIntegration)("identity PostgreSQL integration", () => {
  const createdUserIds: string[] = [];
  let prisma: ReturnType<typeof getPrismaClient>;

  beforeAll(() => {
    prisma = getPrismaClient();
  });

  afterEach(async () => {
    if (!prisma || createdUserIds.length === 0) {
      return;
    }

    const ids = [...createdUserIds];
    createdUserIds.length = 0;
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it("creates a user with an ACTIVE status", async () => {
    const user = await prisma.user.create({ data: {} });
    createdUserIds.push(user.id);

    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(user.status).toBe("ACTIVE");
    expect(user.deletedAt).toBeNull();
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });

  it("creates one profile for a user and looks it up by normalized username", async () => {
    const user = await prisma.user.create({ data: { status: "SUSPENDED" } });
    createdUserIds.push(user.id);

    const username = `Ada_${randomUUID().slice(0, 8)}`;
    const profile = await prisma.profile.create({
      data: {
        userId: user.id,
        username,
        usernameNormalized: normalizeUsername(username),
        displayName: "Ada Lovelace",
        bio: "Builder",
      },
    });

    const found = await prisma.profile.findUnique({
      where: { usernameNormalized: normalizeUsername(username) },
    });

    expect(user.status).toBe("SUSPENDED");
    expect(profile.userId).toBe(user.id);
    expect(found?.id).toBe(profile.id);
    expect(found?.usernameNormalized).toBe(username.toLowerCase());
  });

  it("enforces one profile per user", async () => {
    const user = await prisma.user.create({ data: {} });
    createdUserIds.push(user.id);

    await prisma.profile.create({
      data: {
        userId: user.id,
        username: `one_${randomUUID().slice(0, 8)}`,
        usernameNormalized: `one_${randomUUID().slice(0, 8)}`,
        displayName: "One",
      },
    });

    await expect(
      prisma.profile.create({
        data: {
          userId: user.id,
          username: `two_${randomUUID().slice(0, 8)}`,
          usernameNormalized: `two_${randomUUID().slice(0, 8)}`,
          displayName: "Two",
        },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      );
    });
  });

  it("enforces unique usernameNormalized values", async () => {
    const first = await prisma.user.create({ data: {} });
    const second = await prisma.user.create({ data: {} });
    createdUserIds.push(first.id, second.id);

    const username = `Unique_${randomUUID().slice(0, 8)}`;
    await prisma.profile.create({
      data: {
        userId: first.id,
        username,
        usernameNormalized: normalizeUsername(username),
        displayName: "First",
      },
    });

    await expect(
      prisma.profile.create({
        data: {
          userId: second.id,
          username,
          usernameNormalized: normalizeUsername(username),
          displayName: "Second",
        },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      );
    });
  });

  it("creates a session for an existing user and stores expiration", async () => {
    const user = await prisma.user.create({ data: {} });
    createdUserIds.push(user.id);

    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(`session-${randomUUID()}`),
        expiresAt,
      },
    });

    expect(session.userId).toBe(user.id);
    expect(session.tokenHash).toHaveLength(64);
    expect(session.expiresAt.toISOString()).toBe(expiresAt.toISOString());
  });

  it("enforces unique session token hashes", async () => {
    const user = await prisma.user.create({ data: {} });
    createdUserIds.push(user.id);
    const hash = tokenHash(`dup-${randomUUID()}`);

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });

    await expect(
      prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hash,
          expiresAt: new Date("2031-01-01T00:00:00.000Z"),
        },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      );
    });
  });

  it("rejects a session that references a nonexistent user", async () => {
    await expect(
      prisma.session.create({
        data: {
          userId: randomUUID(),
          tokenHash: tokenHash(`orphan-${randomUUID()}`),
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      );
    });
  });

  it("cascades profile and session deletion when the user is deleted", async () => {
    const user = await prisma.user.create({ data: {} });
    const username = `del_${randomUUID().slice(0, 8)}`;
    const hash = tokenHash(`del-${randomUUID()}`);

    await prisma.profile.create({
      data: {
        userId: user.id,
        username,
        usernameNormalized: normalizeUsername(username),
        displayName: "Delete Me",
      },
    });
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.profile.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(
      await prisma.session.findUnique({ where: { tokenHash: hash } }),
    ).toBeNull();
  });

  it("reports database health ready only after a real PostgreSQL ping", async () => {
    const result = await getDatabaseHealth(process.env, async () => {
      await prisma.$queryRaw`SELECT 1`;
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ status: "ready", service: "postgres" });
    expect(JSON.stringify(result)).not.toContain("postgresql://");
  });
});
