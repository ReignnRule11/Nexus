import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as follow } from "@/app/api/users/[id]/follow/route";
import { DELETE as unfollow } from "@/app/api/users/[id]/follow/route";
import { POST as block } from "@/app/api/users/[id]/block/route";
import { DELETE as unblock } from "@/app/api/users/[id]/block/route";
import { GET as getRelationship } from "@/app/api/users/[id]/relationship/route";
import { GET as getFollowers } from "@/app/api/users/[id]/followers/route";
import { GET as getFollowing } from "@/app/api/users/[id]/following/route";
import { GET as searchUsersRoute } from "@/app/api/users/search/route";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { GRAPH_SEMANTICS } from "@/lib/graph";
import {
  ensureTestAuthSecret,
  uniqueEmail,
  uniqueUsername,
} from "@/tests/user-fixtures";

const env = loadEnv(process.env);
const databaseUrl = env.databaseUrl;
const TEST_DATABASE_NAME = "nexus_test";
const ORIGIN = "http://localhost";
const PASSWORD = "correct-horse-battery";

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

function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((entry) => entry.split(";")[0])
    .filter((part): part is string => Boolean(part))
    .join("; ");
}

type JsonUser = {
  user: {
    id: string;
    email: string;
    status: string;
    profile: { username: string; displayName: string; bio: string | null };
  };
};
type JsonRelationship = {
  relationship: {
    following: boolean;
    followedBy: boolean;
    blocked: boolean;
    blockedBy: boolean;
    mutual: boolean;
  };
  counts?: { followerCount: number; followingCount: number } | null;
};
type JsonPage = {
  items: Array<{
    userId: string;
    username: string;
    displayName: string;
    bio: string | null;
  }>;
  nextCursor: string | null;
};

const routeContext = (id: string) => ({ params: Promise.resolve({ id }) });

async function issueCsrf(existingCookies: string[] = []) {
  const response = await getCsrf(
    new Request(`${ORIGIN}/api/auth/csrf`, {
      headers: existingCookies.length
        ? { cookie: cookieHeader(existingCookies) }
        : undefined,
    }),
  );
  const body = (await response.json()) as { csrfToken: string };
  return {
    token: body.csrfToken,
    cookies:
      cookiePairs(response).length > 0 ? cookiePairs(response) : existingCookies,
  };
}

function requestFor(
  path: string,
  options: {
    method: string;
    cookies?: string[];
    csrf?: string;
    body?: unknown;
  },
): Request {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.csrf) {
    headers["x-csrf-token"] = options.csrf;
  }
  if (options.cookies && options.cookies.length > 0) {
    headers.cookie = cookieHeader(options.cookies);
  }
  return new Request(`${ORIGIN}${path}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe.skipIf(canRunIntegration)(
  "social graph PostgreSQL integration (blocked by environment)",
  () => {
    it("does not mutate PostgreSQL unless DATABASE_URL points at nexus_test", () => {
      expect(connectedDatabaseName === TEST_DATABASE_NAME).toBe(false);
    });
  },
);

describe.skipIf(!canRunIntegration)("social graph PostgreSQL integration", () => {
  const createdUserIds: string[] = [];
  let prisma: ReturnType<typeof getPrismaClient>;

  beforeAll(() => {
    ensureTestAuthSecret();
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

  async function registerAccount(overrides: Record<string, unknown> = {}) {
    const csrf = await issueCsrf();
    const payload = {
      email: uniqueEmail("g"),
      password: PASSWORD,
      username: uniqueUsername("g"),
      displayName: "Graph User",
      ...overrides,
    };
    const response = await register(
      requestFor("/api/auth/register", {
        method: "POST",
        cookies: csrf.cookies,
        csrf: csrf.token,
        body: payload,
      }),
    );
    const body = (await response.json()) as JsonUser;
    const cookies = cookiePairs(response);
    if (body.user?.id) {
      createdUserIds.push(body.user.id);
    }
    return { response, body, cookies };
  }

  async function mutate(
    cookies: string[],
    handler: typeof follow,
    id: string,
    method: "POST" | "DELETE",
    path: string,
  ) {
    const csrf = await issueCsrf(cookies);
    return handler(
      requestFor(path, { method, cookies, csrf: csrf.token }),
      routeContext(id),
    );
  }

  it("follows another active user and handles duplicate follows", async () => {
    const actor = await registerAccount({ displayName: "Ada" });
    const target = await registerAccount({ displayName: "Byron" });
    const first = await mutate(
      actor.cookies,
      follow,
      target.body.user.id,
      "POST",
      `/api/users/${target.body.user.id}/follow`,
    );
    const firstBody = (await first.json()) as JsonRelationship;
    expect(first.status).toBe(200);
    expect(firstBody.relationship.following).toBe(true);
    expect(firstBody.relationship.blocked).toBe(false);
    expect(JSON.stringify(firstBody)).not.toContain("password");
    expect(JSON.stringify(firstBody)).not.toContain("tokenHash");

    const second = await mutate(
      actor.cookies,
      follow,
      target.body.user.id,
      "POST",
      `/api/users/${target.body.user.id}/follow`,
    );
    const secondBody = (await second.json()) as JsonRelationship;
    expect(second.status).toBe(200);
    expect(secondBody.relationship.following).toBe(true);
    expect(
      await prisma.follow.count({
        where: {
          followerId: actor.body.user.id,
          followingId: target.body.user.id,
        },
      }),
    ).toBe(1);
  });

  it("rejects self-follow, deleted, suspended, and blocked targets", async () => {
    const actor = await registerAccount();
    const selfFollow = await mutate(
      actor.cookies,
      follow,
      actor.body.user.id,
      "POST",
      `/api/users/${actor.body.user.id}/follow`,
    );
    expect(selfFollow.status).toBe(400);

    const deleted = await registerAccount();
    await prisma.user.update({
      where: { id: deleted.body.user.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    const followDeleted = await mutate(
      actor.cookies,
      follow,
      deleted.body.user.id,
      "POST",
      `/api/users/${deleted.body.user.id}/follow`,
    );
    expect(followDeleted.status).toBe(404);

    const suspended = await registerAccount();
    await prisma.user.update({
      where: { id: suspended.body.user.id },
      data: { status: "SUSPENDED" },
    });
    const followSuspended = await mutate(
      actor.cookies,
      follow,
      suspended.body.user.id,
      "POST",
      `/api/users/${suspended.body.user.id}/follow`,
    );
    expect(followSuspended.status).toBe(403);

    const blocked = await registerAccount();
    await mutate(
      actor.cookies,
      block,
      blocked.body.user.id,
      "POST",
      `/api/users/${blocked.body.user.id}/block`,
    );
    const followBlocked = await mutate(
      actor.cookies,
      follow,
      blocked.body.user.id,
      "POST",
      `/api/users/${blocked.body.user.id}/follow`,
    );
    expect(followBlocked.status).toBe(403);

    const blocker = await registerAccount();
    await mutate(
      blocker.cookies,
      block,
      actor.body.user.id,
      "POST",
      `/api/users/${actor.body.user.id}/block`,
    );
    const followBlockedBy = await mutate(
      actor.cookies,
      follow,
      blocker.body.user.id,
      "POST",
      `/api/users/${blocker.body.user.id}/follow`,
    );
    expect(followBlockedBy.status).toBe(403);
  });

  it("unfollows and treats repeated unfollow as safe", async () => {
    const actor = await registerAccount();
    const target = await registerAccount();
    await mutate(
      actor.cookies,
      follow,
      target.body.user.id,
      "POST",
      `/api/users/${target.body.user.id}/follow`,
    );
    const first = await mutate(
      actor.cookies,
      unfollow,
      target.body.user.id,
      "DELETE",
      `/api/users/${target.body.user.id}/follow`,
    );
    const firstBody = (await first.json()) as JsonRelationship;
    expect(first.status).toBe(200);
    expect(firstBody.relationship.following).toBe(false);

    const second = await mutate(
      actor.cookies,
      unfollow,
      target.body.user.id,
      "DELETE",
      `/api/users/${target.body.user.id}/follow`,
    );
    expect(second.status).toBe(200);
  });

  it("blocks atomically, handles duplicates, and does not restore follows on unblock", async () => {
    expect(GRAPH_SEMANTICS.blockPrecedence).toMatch(/atomically deletes/i);
    const actor = await registerAccount();
    const target = await registerAccount();
    await mutate(
      actor.cookies,
      follow,
      target.body.user.id,
      "POST",
      `/api/users/${target.body.user.id}/follow`,
    );
    await mutate(
      target.cookies,
      follow,
      actor.body.user.id,
      "POST",
      `/api/users/${actor.body.user.id}/follow`,
    );

    const blocked = await mutate(
      actor.cookies,
      block,
      target.body.user.id,
      "POST",
      `/api/users/${target.body.user.id}/block`,
    );
    const blockedBody = (await blocked.json()) as JsonRelationship;
    expect(blocked.status).toBe(200);
    expect(blockedBody.relationship.blocked).toBe(true);
    expect(blockedBody.relationship.following).toBe(false);
    expect(blockedBody.relationship.followedBy).toBe(false);
    expect(
      await prisma.follow.count({
        where: {
          OR: [
            { followerId: actor.body.user.id, followingId: target.body.user.id },
            { followerId: target.body.user.id, followingId: actor.body.user.id },
          ],
        },
      }),
    ).toBe(0);

    const duplicate = await mutate(
      actor.cookies,
      block,
      target.body.user.id,
      "POST",
      `/api/users/${target.body.user.id}/block`,
    );
    expect(duplicate.status).toBe(200);

    const selfBlock = await mutate(
      actor.cookies,
      block,
      actor.body.user.id,
      "POST",
      `/api/users/${actor.body.user.id}/block`,
    );
    expect(selfBlock.status).toBe(400);

    const unblocked = await mutate(
      actor.cookies,
      unblock,
      target.body.user.id,
      "DELETE",
      `/api/users/${target.body.user.id}/block`,
    );
    const unblockedBody = (await unblocked.json()) as JsonRelationship;
    expect(unblocked.status).toBe(200);
    expect(unblockedBody.relationship.blocked).toBe(false);
    expect(unblockedBody.relationship.following).toBe(false);
    expect(
      await prisma.follow.count({
        where: {
          OR: [
            { followerId: actor.body.user.id, followingId: target.body.user.id },
            { followerId: target.body.user.id, followingId: actor.body.user.id },
          ],
        },
      }),
    ).toBe(0);

    const repeatUnblock = await mutate(
      actor.cookies,
      unblock,
      target.body.user.id,
      "DELETE",
      `/api/users/${target.body.user.id}/block`,
    );
    expect(repeatUnblock.status).toBe(200);
  });

  it("reports following, followed-by, mutual, and blocked relationship state", async () => {
    const a = await registerAccount();
    const b = await registerAccount();
    await mutate(
      a.cookies,
      follow,
      b.body.user.id,
      "POST",
      `/api/users/${b.body.user.id}/follow`,
    );
    await mutate(
      b.cookies,
      follow,
      a.body.user.id,
      "POST",
      `/api/users/${a.body.user.id}/follow`,
    );

    const mutual = await getRelationship(
      requestFor(`/api/users/${b.body.user.id}/relationship`, {
        method: "GET",
        cookies: a.cookies,
      }),
      routeContext(b.body.user.id),
    );
    const mutualBody = (await mutual.json()) as JsonRelationship;
    expect(mutual.status).toBe(200);
    expect(mutualBody.relationship).toEqual({
      following: true,
      followedBy: true,
      blocked: false,
      blockedBy: false,
      mutual: true,
    });
    expect(mutualBody.counts?.followerCount).toBe(1);
    expect(mutualBody.counts?.followingCount).toBe(1);

    await mutate(
      a.cookies,
      block,
      b.body.user.id,
      "POST",
      `/api/users/${b.body.user.id}/block`,
    );
    const afterBlock = await getRelationship(
      requestFor(`/api/users/${b.body.user.id}/relationship`, {
        method: "GET",
        cookies: a.cookies,
      }),
      routeContext(b.body.user.id),
    );
    const afterBlockBody = (await afterBlock.json()) as JsonRelationship;
    expect(afterBlockBody.relationship.blocked).toBe(true);
    expect(afterBlockBody.relationship.following).toBe(false);
    expect(afterBlockBody.relationship.blockedBy).toBe(false);

    const blockedView = await getRelationship(
      requestFor(`/api/users/${a.body.user.id}/relationship`, {
        method: "GET",
        cookies: b.cookies,
      }),
      routeContext(a.body.user.id),
    );
    expect(blockedView.status).toBe(404);
    const blockedPayload = JSON.stringify(await blockedView.json());
    expect(blockedPayload).not.toContain("blockedBy");
    expect(blockedPayload).not.toContain("P2002");
  });

  it("updates follower and following counts after mutations", async () => {
    const a = await registerAccount();
    const b = await registerAccount();
    const c = await registerAccount();
    await mutate(
      b.cookies,
      follow,
      a.body.user.id,
      "POST",
      `/api/users/${a.body.user.id}/follow`,
    );
    await mutate(
      c.cookies,
      follow,
      a.body.user.id,
      "POST",
      `/api/users/${a.body.user.id}/follow`,
    );
    await mutate(
      a.cookies,
      follow,
      b.body.user.id,
      "POST",
      `/api/users/${b.body.user.id}/follow`,
    );

    const view = await getRelationship(
      requestFor(`/api/users/${a.body.user.id}/relationship`, {
        method: "GET",
        cookies: a.cookies,
      }),
      routeContext(a.body.user.id),
    );
    const body = (await view.json()) as JsonRelationship;
    expect(body.counts?.followerCount).toBe(2);
    expect(body.counts?.followingCount).toBe(1);
  });

  it("lists followers and following with pagination, excluding deleted and blocked users", async () => {
    const target = await registerAccount({ username: uniqueUsername("hub") });
    const visible = await registerAccount({
      username: uniqueUsername("vis"),
      displayName: "Visible Friend",
    });
    const hidden = await registerAccount({ username: uniqueUsername("hid") });
    const extra = await registerAccount({ username: uniqueUsername("ext") });
    await mutate(
      visible.cookies,
      follow,
      target.body.user.id,
      "POST",
      `/api/users/${target.body.user.id}/follow`,
    );
    await mutate(
      hidden.cookies,
      follow,
      target.body.user.id,
      "POST",
      `/api/users/${target.body.user.id}/follow`,
    );
    await mutate(
      extra.cookies,
      follow,
      target.body.user.id,
      "POST",
      `/api/users/${target.body.user.id}/follow`,
    );
    await mutate(
      target.cookies,
      follow,
      visible.body.user.id,
      "POST",
      `/api/users/${visible.body.user.id}/follow`,
    );
    await mutate(
      target.cookies,
      block,
      hidden.body.user.id,
      "POST",
      `/api/users/${hidden.body.user.id}/block`,
    );
    await prisma.user.update({
      where: { id: extra.body.user.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });

    const followers = await getFollowers(
      requestFor(`/api/users/${target.body.user.id}/followers?limit=20`, {
        method: "GET",
        cookies: target.cookies,
      }),
      routeContext(target.body.user.id),
    );
    const followersBody = (await followers.json()) as JsonPage;
    expect(followers.status).toBe(200);
    expect(followersBody.items.map((item) => item.userId)).toEqual([
      visible.body.user.id,
    ]);
    expect(JSON.stringify(followersBody)).not.toContain("passwordHash");
    expect(JSON.stringify(followersBody)).not.toContain("email");

    const paged = await getFollowers(
      requestFor(`/api/users/${target.body.user.id}/followers?limit=1`, {
        method: "GET",
        cookies: visible.cookies,
      }),
      routeContext(target.body.user.id),
    );
    const pagedBody = (await paged.json()) as JsonPage;
    expect(pagedBody.items).toHaveLength(1);

    const following = await getFollowing(
      requestFor(`/api/users/${target.body.user.id}/following`, {
        method: "GET",
        cookies: target.cookies,
      }),
      routeContext(target.body.user.id),
    );
    const followingBody = (await following.json()) as JsonPage;
    expect(followingBody.items.map((item) => item.userId)).toEqual([
      visible.body.user.id,
    ]);
  });

  it("searches by username and display name with deterministic ordering and privacy filters", async () => {
    const marker = uniqueUsername("seek").slice(0, 12);
    const actor = await registerAccount({
      username: `${marker}a`,
      displayName: `Alpha ${marker}`,
    });
    const matchName = await registerAccount({
      username: uniqueUsername("zz"),
      displayName: `Zed ${marker}`,
    });
    const matchUser = await registerAccount({
      username: `${marker}b`,
      displayName: "Other",
    });
    const blocked = await registerAccount({
      username: `${marker}c`,
      displayName: `Blocked ${marker}`,
    });
    const deleted = await registerAccount({
      username: `${marker}d`,
      displayName: `Gone ${marker}`,
    });
    const suspended = await registerAccount({
      username: `${marker}e`,
      displayName: `Paused ${marker}`,
    });
    await mutate(
      actor.cookies,
      block,
      blocked.body.user.id,
      "POST",
      `/api/users/${blocked.body.user.id}/block`,
    );
    await prisma.user.update({
      where: { id: deleted.body.user.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    await prisma.user.update({
      where: { id: suspended.body.user.id },
      data: { status: "SUSPENDED" },
    });

    const usernameSearch = await searchUsersRoute(
      requestFor(`/api/users/search?q=${marker}&limit=20`, {
        method: "GET",
        cookies: actor.cookies,
      }),
    );
    const usernameBody = (await usernameSearch.json()) as JsonPage;
    expect(usernameSearch.status).toBe(200);
    const ids = usernameBody.items.map((item) => item.userId);
    expect(ids).toContain(matchUser.body.user.id);
    expect(ids).toContain(matchName.body.user.id);
    expect(ids).toContain(suspended.body.user.id);
    expect(ids).not.toContain(blocked.body.user.id);
    expect(ids).not.toContain(deleted.body.user.id);
    expect(ids).not.toContain(actor.body.user.id);
    const usernames = usernameBody.items.map((item) => item.username);
    expect([...usernames].sort((left, right) => left.localeCompare(right))).toEqual(
      usernames,
    );
    expect(JSON.stringify(usernameBody)).not.toContain("password");
    expect(JSON.stringify(usernameBody)).not.toContain("emailNormalized");

    const firstPage = await searchUsersRoute(
      requestFor(`/api/users/search?q=${marker}&limit=1`, {
        method: "GET",
        cookies: actor.cookies,
      }),
    );
    const firstBody = (await firstPage.json()) as JsonPage;
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.nextCursor).toBeTruthy();
    const secondPage = await searchUsersRoute(
      requestFor(
        `/api/users/search?q=${marker}&limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
        { method: "GET", cookies: actor.cookies },
      ),
    );
    const secondBody = (await secondPage.json()) as JsonPage;
    expect(secondBody.items[0]?.userId).not.toBe(firstBody.items[0]?.userId);
  });

  it("rejects unauthenticated, inactive, CSRF-less, and cross-user mutations", async () => {
    const actor = await registerAccount();
    const target = await registerAccount();
    const anonymousCsrf = await issueCsrf();
    const unauthenticated = await follow(
      requestFor(`/api/users/${target.body.user.id}/follow`, {
        method: "POST",
        csrf: anonymousCsrf.token,
        cookies: anonymousCsrf.cookies,
      }),
      routeContext(target.body.user.id),
    );
    expect(unauthenticated.status).toBe(401);

    const noCsrf = await follow(
      requestFor(`/api/users/${target.body.user.id}/follow`, {
        method: "POST",
        cookies: actor.cookies,
      }),
      routeContext(target.body.user.id),
    );
    expect(noCsrf.status).toBe(403);

    await prisma.user.update({
      where: { id: actor.body.user.id },
      data: { status: "SUSPENDED" },
    });
    const suspended = await mutate(
      actor.cookies,
      follow,
      target.body.user.id,
      "POST",
      `/api/users/${target.body.user.id}/follow`,
    );
    expect(suspended.status).toBe(403);

    await prisma.user.update({
      where: { id: actor.body.user.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    const deleted = await mutate(
      actor.cookies,
      follow,
      target.body.user.id,
      "POST",
      `/api/users/${target.body.user.id}/follow`,
    );
    expect(deleted.status).toBe(403);
  });

  it("enforces unique follow/block constraints and self-relationship checks in PostgreSQL", async () => {
    const first = await registerAccount();
    const second = await registerAccount();
    await prisma.follow.create({
      data: {
        followerId: first.body.user.id,
        followingId: second.body.user.id,
      },
    });
    await expect(
      prisma.follow.create({
        data: {
          followerId: first.body.user.id,
          followingId: second.body.user.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.follow.create({
        data: {
          followerId: first.body.user.id,
          followingId: first.body.user.id,
        },
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.block.create({
        data: {
          blockerId: first.body.user.id,
          blockedId: first.body.user.id,
        },
      }),
    ).rejects.toBeTruthy();
  });
});
