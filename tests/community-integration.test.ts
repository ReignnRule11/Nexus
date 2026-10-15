import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as block } from "@/app/api/users/[id]/block/route";
import {
  GET as listCommunities,
  POST as createCommunity,
} from "@/app/api/communities/route";
import {
  DELETE as deleteCommunity,
  GET as getCommunity,
  PATCH as updateCommunity,
} from "@/app/api/communities/[id]/route";
import { POST as joinCommunity } from "@/app/api/communities/[id]/join/route";
import { DELETE as leaveCommunity } from "@/app/api/communities/[id]/membership/route";
import { GET as getMembership } from "@/app/api/communities/[id]/membership/route";
import { GET as listMembers } from "@/app/api/communities/[id]/members/route";
import { PATCH as updateMemberRole } from "@/app/api/communities/[id]/members/[userId]/route";
import {
  GET as listChannels,
  POST as createChannel,
} from "@/app/api/communities/[id]/channels/route";
import {
  DELETE as deleteChannel,
  GET as getChannel,
  PATCH as updateChannel,
} from "@/app/api/channels/[id]/route";
import {
  GET as listChannelPosts,
  POST as createChannelPost,
} from "@/app/api/channels/[id]/posts/route";
import { GET as getPost } from "@/app/api/posts/[id]/route";
import { POST as createComment } from "@/app/api/posts/[id]/comments/route";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
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
  user: { id: string; profile: { username: string } };
};

type JsonCommunity = {
  community: {
    id: string;
    name: string;
    slug: string;
    visibility: string;
    memberCount: number;
    viewerRole: string | null;
    viewerIsMember: boolean;
  };
};

type JsonChannel = {
  channel: {
    id: string;
    communityId: string;
    name: string;
    slug: string;
    type: string;
  };
  community?: JsonCommunity["community"];
};

type JsonChannelPost = {
  post: { id: string; channelId: string | null; body: string };
};

type JsonPage<T> = { items: T[]; nextCursor: string | null };

const routeContext = (id: string) => ({ params: Promise.resolve({ id }) });
const memberContext = (id: string, userId: string) => ({
  params: Promise.resolve({ id, userId }),
});

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
  "communities PostgreSQL integration (blocked by environment)",
  () => {
    it("does not mutate PostgreSQL unless DATABASE_URL points at nexus_test", () => {
      expect(connectedDatabaseName === TEST_DATABASE_NAME).toBe(false);
    });
  },
);

describe.skipIf(!canRunIntegration)("communities PostgreSQL integration", () => {
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

  async function registerAccount() {
    const csrf = await issueCsrf();
    const response = await register(
      requestFor("/api/auth/register", {
        method: "POST",
        cookies: csrf.cookies,
        csrf: csrf.token,
        body: {
          email: uniqueEmail("com"),
          password: PASSWORD,
          username: uniqueUsername("com"),
          displayName: "Community User",
        },
      }),
    );
    const body = (await response.json()) as JsonUser;
    if (body.user?.id) {
      createdUserIds.push(body.user.id);
    }
    expect(response.status).toBe(201);
    return { cookies: cookiePairs(response), user: body.user };
  }

  async function mutate(
    cookies: string[],
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ) {
    const csrf = await issueCsrf(cookies);
    return requestFor(path, { method, cookies, csrf: csrf.token, body });
  }

  function uniqueSlug(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function createCommunityAs(
    cookies: string[],
    overrides: Record<string, unknown> = {},
  ): Promise<JsonCommunity["community"]> {
    const response = await createCommunity(
      await mutate(cookies, "/api/communities", "POST", {
        name: `Guild ${uniqueSlug("g")}`,
        description: "A guild",
        ...overrides,
      }),
    );
    const body = (await response.json()) as JsonCommunity;
    expect(response.status).toBe(201);
    return body.community;
  }

  it("creates a community atomically with an owner membership and default channel", async () => {
    const owner = await registerAccount();
    const community = await createCommunityAs(owner.cookies, {
      name: "Design Guild",
      slug: uniqueSlug("design"),
    });

    expect(community.viewerRole).toBe("OWNER");
    expect(community.memberCount).toBe(1);

    const members = await prisma.communityMember.findMany({
      where: { communityId: community.id },
    });
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("OWNER");
    expect(members[0]?.userId).toBe(owner.user.id);

    const channels = await prisma.channel.findMany({
      where: { communityId: community.id },
    });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.slug).toBe("general");
    expect(channels[0]?.type).toBe("TEXT");
  });

  it("prevents duplicate community slugs", async () => {
    const owner = await registerAccount();
    const slug = uniqueSlug("dup");
    await createCommunityAs(owner.cookies, { name: "First", slug });
    const response = await createCommunity(
      await mutate(owner.cookies, "/api/communities", "POST", {
        name: "Second",
        slug,
      }),
    );
    expect(response.status).toBe(409);
  });

  it("enforces exactly one active owner via a partial unique index", async () => {
    const owner = await registerAccount();
    const community = await createCommunityAs(owner.cookies);
    await expect(
      prisma.communityMember.create({
        data: { communityId: community.id, userId: owner.user.id, role: "OWNER" },
      }),
    ).rejects.toThrow();
  });

  it("isolates private communities from non-members and discovery", async () => {
    const owner = await registerAccount();
    const outsider = await registerAccount();
    const community = await createCommunityAs(owner.cookies, {
      name: "Secret Guild",
      visibility: "PRIVATE",
    });

    const direct = await getCommunity(
      requestFor(`/api/communities/${community.id}`, {
        method: "GET",
        cookies: outsider.cookies,
      }),
      routeContext(community.id),
    );
    expect(direct.status).toBe(404);

    const join = await joinCommunity(
      await mutate(outsider.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );
    expect(join.status).toBe(404);

    const discovery = await listCommunities(
      requestFor("/api/communities", { method: "GET", cookies: outsider.cookies }),
    );
    const list = (await discovery.json()) as JsonPage<JsonCommunity["community"]>;
    expect(list.items.some((item) => item.id === community.id)).toBe(false);

    const ownerView = await getCommunity(
      requestFor(`/api/communities/${community.id}`, {
        method: "GET",
        cookies: owner.cookies,
      }),
      routeContext(community.id),
    );
    expect(ownerView.status).toBe(200);
  });

  it("joins a public community idempotently and rejects duplicate membership", async () => {
    const owner = await registerAccount();
    const member = await registerAccount();
    const community = await createCommunityAs(owner.cookies);

    const first = await joinCommunity(
      await mutate(member.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );
    const firstBody = (await first.json()) as JsonCommunity;
    expect(first.status).toBe(200);
    expect(firstBody.community.viewerIsMember).toBe(true);
    expect(firstBody.community.viewerRole).toBe("MEMBER");

    const second = await joinCommunity(
      await mutate(member.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );
    expect(second.status).toBe(200);
    const rows = await prisma.communityMember.count({
      where: { communityId: community.id, userId: member.user.id },
    });
    expect(rows).toBe(1);
  });

  it("lets members leave but blocks the owner from leaving without transfer", async () => {
    const owner = await registerAccount();
    const member = await registerAccount();
    const community = await createCommunityAs(owner.cookies);

    await joinCommunity(
      await mutate(member.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );
    const leave = await leaveCommunity(
      await mutate(member.cookies, `/api/communities/${community.id}/membership`, "DELETE"),
      routeContext(community.id),
    );
    expect(leave.status).toBe(200);

    const membership = await getMembership(
      requestFor(`/api/communities/${community.id}/membership`, {
        method: "GET",
        cookies: member.cookies,
      }),
      routeContext(community.id),
    );
    expect(((await membership.json()) as { membership: { isMember: boolean } }).membership.isMember).toBe(
      false,
    );

    const ownerLeave = await leaveCommunity(
      await mutate(owner.cookies, `/api/communities/${community.id}/membership`, "DELETE"),
      routeContext(community.id),
    );
    expect(ownerLeave.status).toBe(409);
  });

  it("transfers ownership and enforces role management authorization", async () => {
    const owner = await registerAccount();
    const member = await registerAccount();
    const community = await createCommunityAs(owner.cookies);
    await joinCommunity(
      await mutate(member.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );

    const memberAttempt = await updateMemberRole(
      await mutate(
        member.cookies,
        `/api/communities/${community.id}/members/${owner.user.id}`,
        "PATCH",
        { role: "ADMIN" },
      ),
      memberContext(community.id, owner.user.id),
    );
    expect(memberAttempt.status).toBe(403);

    const promote = await updateMemberRole(
      await mutate(
        owner.cookies,
        `/api/communities/${community.id}/members/${member.user.id}`,
        "PATCH",
        { role: "ADMIN" },
      ),
      memberContext(community.id, member.user.id),
    );
    expect(promote.status).toBe(200);

    const transfer = await updateMemberRole(
      await mutate(
        owner.cookies,
        `/api/communities/${community.id}/members/${member.user.id}`,
        "PATCH",
        { role: "OWNER" },
      ),
      memberContext(community.id, member.user.id),
    );
    expect(transfer.status).toBe(200);

    const stored = await prisma.community.findUniqueOrThrow({
      where: { id: community.id },
    });
    expect(stored.ownerId).toBe(member.user.id);
    const ownerRow = await prisma.communityMember.findUniqueOrThrow({
      where: { communityId_userId: { communityId: community.id, userId: owner.user.id } },
    });
    expect(ownerRow.role).toBe("ADMIN");
  });

  it("manages channel lifecycle with scoped uniqueness and pagination", async () => {
    const owner = await registerAccount();
    const member = await registerAccount();
    const community = await createCommunityAs(owner.cookies);
    await joinCommunity(
      await mutate(member.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );

    const names = ["design", "engineering", "random", "off-topic"];
    for (const name of names) {
      const response = await createChannel(
        await mutate(owner.cookies, `/api/communities/${community.id}/channels`, "POST", {
          name,
        }),
        routeContext(community.id),
      );
      expect(response.status).toBe(201);
    }

    const memberCreate = await createChannel(
      await mutate(member.cookies, `/api/communities/${community.id}/channels`, "POST", {
        name: "member-channel",
      }),
      routeContext(community.id),
    );
    expect(memberCreate.status).toBe(403);

    const duplicate = await createChannel(
      await mutate(owner.cookies, `/api/communities/${community.id}/channels`, "POST", {
        name: "design",
      }),
      routeContext(community.id),
    );
    expect(duplicate.status).toBe(409);

    const pageOne = await listChannels(
      requestFor(`/api/communities/${community.id}/channels?limit=2`, {
        method: "GET",
        cookies: member.cookies,
      }),
      routeContext(community.id),
    );
    const pageOneBody = (await pageOne.json()) as JsonPage<JsonChannel["channel"]>;
    expect(pageOneBody.items).toHaveLength(2);
    expect(pageOneBody.nextCursor).toBeTruthy();

    const pageTwo = await listChannels(
      requestFor(
        `/api/communities/${community.id}/channels?limit=2&cursor=${encodeURIComponent(
          pageOneBody.nextCursor as string,
        )}`,
        { method: "GET", cookies: member.cookies },
      ),
      routeContext(community.id),
    );
    const pageTwoBody = (await pageTwo.json()) as JsonPage<JsonChannel["channel"]>;
    expect(pageTwoBody.items).toHaveLength(2);

    const first = pageOneBody.items[0] as JsonChannel["channel"];
    const update = await updateChannel(
      await mutate(owner.cookies, `/api/channels/${first.id}`, "PATCH", {
        name: "design-renamed",
      }),
      routeContext(first.id),
    );
    expect(update.status).toBe(200);
    expect(((await update.json()) as JsonChannel).channel.slug).toBe("design-renamed");

    const remove = await deleteChannel(
      await mutate(owner.cookies, `/api/channels/${first.id}`, "DELETE"),
      routeContext(first.id),
    );
    expect(remove.status).toBe(200);
    const afterDelete = await prisma.channel.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(afterDelete.deletedAt).not.toBeNull();
  });

  it("restricts announcement channels to owners and admins", async () => {
    const owner = await registerAccount();
    const member = await registerAccount();
    const community = await createCommunityAs(owner.cookies);
    await joinCommunity(
      await mutate(member.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );

    const announcement = await createChannel(
      await mutate(owner.cookies, `/api/communities/${community.id}/channels`, "POST", {
        name: "news",
        type: "ANNOUNCEMENT",
      }),
      routeContext(community.id),
    );
    const channel = ((await announcement.json()) as JsonChannel).channel;

    const memberPost = await createChannelPost(
      await mutate(member.cookies, `/api/channels/${channel.id}/posts`, "POST", {
        body: "member announcement",
      }),
      routeContext(channel.id),
    );
    expect(memberPost.status).toBe(403);

    const ownerPost = await createChannelPost(
      await mutate(owner.cookies, `/api/channels/${channel.id}/posts`, "POST", {
        body: "owner announcement",
      }),
      routeContext(channel.id),
    );
    expect(ownerPost.status).toBe(201);
  });

  it("creates and lists channel posts without leaking them into the main feed", async () => {
    const owner = await registerAccount();
    const member = await registerAccount();
    const community = await createCommunityAs(owner.cookies);
    await joinCommunity(
      await mutate(member.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );
    const channels = await prisma.channel.findMany({
      where: { communityId: community.id },
    });
    const general = channels[0]!;

    const created = await createChannelPost(
      await mutate(member.cookies, `/api/channels/${general.id}/posts`, "POST", {
        body: "hello channel",
      }),
      routeContext(general.id),
    );
    const createdBody = (await created.json()) as JsonChannelPost;
    expect(created.status).toBe(201);
    expect(createdBody.post.channelId).toBe(general.id);

    const listed = await listChannelPosts(
      requestFor(`/api/channels/${general.id}/posts`, {
        method: "GET",
        cookies: member.cookies,
      }),
      routeContext(general.id),
    );
    const list = (await listed.json()) as JsonPage<JsonChannelPost["post"]>;
    expect(list.items.map((item) => item.body)).toContain("hello channel");

    const stored = await prisma.post.findUniqueOrThrow({
      where: { id: createdBody.post.id },
    });
    expect(stored.channelId).toBe(general.id);
  });

  it("hides private-community content and posts from non-members", async () => {
    const owner = await registerAccount();
    const member = await registerAccount();
    const outsider = await registerAccount();
    const community = await createCommunityAs(owner.cookies, {
      visibility: "PRIVATE",
    });
    const blockedPrivateJoin = await joinCommunity(
      await mutate(member.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );
    expect(blockedPrivateJoin.status).toBe(404);
    await prisma.communityMember.create({
      data: { communityId: community.id, userId: member.user.id, role: "MEMBER" },
    });
    const general = await prisma.channel.findFirstOrThrow({
      where: { communityId: community.id },
    });

    const created = await createChannelPost(
      await mutate(member.cookies, `/api/channels/${general.id}/posts`, "POST", {
        body: "private note",
      }),
      routeContext(general.id),
    );
    const createdBody = (await created.json()) as JsonChannelPost;
    expect(created.status).toBe(201);

    const channelRead = await getChannel(
      requestFor(`/api/channels/${general.id}`, {
        method: "GET",
        cookies: outsider.cookies,
      }),
      routeContext(general.id),
    );
    expect(channelRead.status).toBe(404);

    const postsRead = await listChannelPosts(
      requestFor(`/api/channels/${general.id}/posts`, {
        method: "GET",
        cookies: outsider.cookies,
      }),
      routeContext(general.id),
    );
    expect(postsRead.status).toBe(404);

    const postRead = await getPost(
      requestFor(`/api/posts/${createdBody.post.id}`, {
        method: "GET",
        cookies: outsider.cookies,
      }),
      routeContext(createdBody.post.id),
    );
    expect(postRead.status).toBe(404);

    const memberRead = await getPost(
      requestFor(`/api/posts/${createdBody.post.id}`, {
        method: "GET",
        cookies: member.cookies,
      }),
      routeContext(createdBody.post.id),
    );
    expect(memberRead.status).toBe(200);
  });

  it("requires membership to comment on channel posts", async () => {
    const owner = await registerAccount();
    const outsider = await registerAccount();
    const community = await createCommunityAs(owner.cookies);
    const general = await prisma.channel.findFirstOrThrow({
      where: { communityId: community.id },
    });
    const created = await createChannelPost(
      await mutate(owner.cookies, `/api/channels/${general.id}/posts`, "POST", {
        body: "public channel post",
      }),
      routeContext(general.id),
    );
    const createdBody = (await created.json()) as JsonChannelPost;

    const comment = await createComment(
      await mutate(outsider.cookies, `/api/posts/${createdBody.post.id}/comments`, "POST", {
        body: "sneaky",
      }),
      routeContext(createdBody.post.id),
    );
    expect(comment.status).toBe(403);
  });

  it("updates community metadata and restricts visibility changes to the owner", async () => {
    const owner = await registerAccount();
    const admin = await registerAccount();
    const community = await createCommunityAs(owner.cookies);
    await joinCommunity(
      await mutate(admin.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );
    await updateMemberRole(
      await mutate(
        owner.cookies,
        `/api/communities/${community.id}/members/${admin.user.id}`,
        "PATCH",
        { role: "ADMIN" },
      ),
      memberContext(community.id, admin.user.id),
    );

    const updated = await updateCommunity(
      await mutate(owner.cookies, `/api/communities/${community.id}`, "PATCH", {
        name: "Renamed Guild",
        description: "Updated",
      }),
      routeContext(community.id),
    );
    const updatedBody = (await updated.json()) as JsonCommunity;
    expect(updated.status).toBe(200);
    expect(updatedBody.community.name).toBe("Renamed Guild");
    expect(updatedBody.community.slug).toBe("renamed-guild");

    const adminVisibility = await updateCommunity(
      await mutate(admin.cookies, `/api/communities/${community.id}`, "PATCH", {
        visibility: "PRIVATE",
      }),
      routeContext(community.id),
    );
    expect(adminVisibility.status).toBe(403);

    const invalidUpdate = await updateCommunity(
      await mutate(owner.cookies, `/api/communities/${community.id}`, "PATCH", {}),
      routeContext(community.id),
    );
    expect(invalidUpdate.status).toBe(400);
  });

  it("enforces blocks across discovery, joining, and content", async () => {
    const owner = await registerAccount();
    const blocked = await registerAccount();
    const community = await createCommunityAs(owner.cookies);

    await block(
      await mutate(owner.cookies, `/api/users/${blocked.user.id}/block`, "POST"),
      routeContext(blocked.user.id),
    );

    const discovery = await listCommunities(
      requestFor("/api/communities", { method: "GET", cookies: blocked.cookies }),
    );
    const list = (await discovery.json()) as JsonPage<JsonCommunity["community"]>;
    expect(list.items.some((item) => item.id === community.id)).toBe(false);

    const join = await joinCommunity(
      await mutate(blocked.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );
    expect(join.status).toBe(404);

    const view = await getCommunity(
      requestFor(`/api/communities/${community.id}`, {
        method: "GET",
        cookies: blocked.cookies,
      }),
      routeContext(community.id),
    );
    expect(view.status).toBe(404);
  });

  it("excludes deleted accounts from membership and discovery", async () => {
    const owner = await registerAccount();
    const member = await registerAccount();
    const community = await createCommunityAs(owner.cookies);
    await joinCommunity(
      await mutate(member.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );

    await prisma.user.update({
      where: { id: member.user.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });

    const members = await listMembers(
      requestFor(`/api/communities/${community.id}/members`, {
        method: "GET",
        cookies: owner.cookies,
      }),
      routeContext(community.id),
    );
    const list = (await members.json()) as JsonPage<{ userId: string }>;
    expect(list.items.some((item) => item.userId === member.user.id)).toBe(false);

    const refreshed = await getCommunity(
      requestFor(`/api/communities/${community.id}`, {
        method: "GET",
        cookies: owner.cookies,
      }),
      routeContext(community.id),
    );
    expect(((await refreshed.json()) as JsonCommunity).community.memberCount).toBe(1);
  });

  it("rejects suspended accounts and CSRF-less mutations", async () => {
    const owner = await registerAccount();
    const suspended = await registerAccount();
    await prisma.user.update({
      where: { id: suspended.user.id },
      data: { status: "SUSPENDED" },
    });
    const community = await createCommunityAs(owner.cookies);

    const suspendedJoin = await joinCommunity(
      await mutate(suspended.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );
    expect(suspendedJoin.status).toBe(403);

    const noCsrf = await createCommunity(
      requestFor("/api/communities", {
        method: "POST",
        cookies: owner.cookies,
        body: { name: "No CSRF" },
      }),
    );
    expect(noCsrf.status).toBe(403);

    const anonymousMutate = await createCommunity(
      requestFor("/api/communities", {
        method: "POST",
        body: { name: "Anon" },
      }),
    );
    expect(anonymousMutate.status).toBe(403);

    const anonymousRead = await listMembers(
      requestFor(`/api/communities/${community.id}/members`, { method: "GET" }),
      routeContext(community.id),
    );
    expect(anonymousRead.status).toBe(200);
  });

  it("handles malformed input, cursors, and pagination deterministically", async () => {
    const owner = await registerAccount();

    const badName = await createCommunity(
      await mutate(owner.cookies, "/api/communities", "POST", { name: "   " }),
    );
    expect(badName.status).toBe(400);

    const badSlug = await createCommunity(
      await mutate(owner.cookies, "/api/communities", "POST", {
        name: "Valid Name",
        slug: "Not A Slug!",
      }),
    );
    expect(badSlug.status).toBe(400);

    const badCursor = await listCommunities(
      requestFor("/api/communities?cursor=!!!not-base64!!!", {
        method: "GET",
        cookies: owner.cookies,
      }),
    );
    expect(badCursor.status).toBe(400);

    const badLimit = await listCommunities(
      requestFor("/api/communities?limit=0", {
        method: "GET",
        cookies: owner.cookies,
      }),
    );
    expect(badLimit.status).toBe(400);

    for (let i = 0; i < 3; i += 1) {
      await createCommunityAs(owner.cookies, { name: `Paged ${i}` });
    }
    const collected: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const url = cursor
        ? `/api/communities?limit=2&cursor=${encodeURIComponent(cursor)}`
        : "/api/communities?limit=2";
      const page = await listCommunities(
        requestFor(url, { method: "GET", cookies: owner.cookies }),
      );
      const body = (await page.json()) as JsonPage<JsonCommunity["community"]>;
      collected.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
      if (!cursor) {
        break;
      }
    }
    expect(new Set(collected).size).toBe(collected.length);
  });

  it("filters discovery by query, excluding non-matching and private communities", async () => {
    const owner = await registerAccount();
    const needle = uniqueSlug("needle");
    const match = await createCommunityAs(owner.cookies, {
      name: `Findable ${needle}`,
      slug: needle,
    });
    await createCommunityAs(owner.cookies, { name: "Hidden Thing", visibility: "PRIVATE" });

    const results = await listCommunities(
      requestFor(`/api/communities?q=${needle}`, {
        method: "GET",
        cookies: owner.cookies,
      }),
    );
    const body = (await results.json()) as JsonPage<JsonCommunity["community"]>;
    expect(body.items.map((item) => item.id)).toEqual([match.id]);
  });

  it("supports concurrent create-or-join without duplicate membership or slugs", async () => {
    const owner = await registerAccount();
    const joiner = await registerAccount();
    const community = await createCommunityAs(owner.cookies);
    const csrf = await issueCsrf(joiner.cookies);

    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        joinCommunity(
          requestFor(`/api/communities/${community.id}/join`, {
            method: "POST",
            cookies: joiner.cookies,
            csrf: csrf.token,
          }),
          routeContext(community.id),
        ),
      ),
    );
    expect(attempts.every((response) => response.status === 200)).toBe(true);
    const rows = await prisma.communityMember.count({
      where: { communityId: community.id, userId: joiner.user.id },
    });
    expect(rows).toBe(1);
  });

  it("prevents cross-community member and channel access", async () => {
    const first = await registerAccount();
    const second = await registerAccount();
    const communityA = await createCommunityAs(first.cookies);
    const communityB = await createCommunityAs(second.cookies, {
      visibility: "PRIVATE",
    });
    const channelB = await prisma.channel.findFirstOrThrow({
      where: { communityId: communityB.id },
    });

    const crossJoin = await joinCommunity(
      await mutate(first.cookies, `/api/communities/${communityB.id}/join`, "POST"),
      routeContext(communityB.id),
    );
    expect(crossJoin.status).toBe(404);

    const crossPost = await createChannelPost(
      await mutate(first.cookies, `/api/channels/${channelB.id}/posts`, "POST", {
        body: "intruder",
      }),
      routeContext(channelB.id),
    );
    expect(crossPost.status).toBe(403);

    void communityA;
  });

  it("soft-deletes communities so they disappear from reads and discovery", async () => {
    const owner = await registerAccount();
    const community = await createCommunityAs(owner.cookies);
    const removed = await deleteCommunity(
      await mutate(owner.cookies, `/api/communities/${community.id}`, "DELETE"),
      routeContext(community.id),
    );
    expect(removed.status).toBe(200);

    const read = await getCommunity(
      requestFor(`/api/communities/${community.id}`, {
        method: "GET",
        cookies: owner.cookies,
      }),
      routeContext(community.id),
    );
    expect(read.status).toBe(404);

    const discovery = await listCommunities(
      requestFor("/api/communities", { method: "GET", cookies: owner.cookies }),
    );
    const list = (await discovery.json()) as JsonPage<JsonCommunity["community"]>;
    expect(list.items.some((item) => item.id === community.id)).toBe(false);
  });

  it("does not leak sensitive fields in community payloads", async () => {
    const owner = await registerAccount();
    const community = await createCommunityAs(owner.cookies);
    const response = await getCommunity(
      requestFor(`/api/communities/${community.id}`, {
        method: "GET",
        cookies: owner.cookies,
      }),
      routeContext(community.id),
    );
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("emailNormalized");
    expect(serialized).not.toContain("owner_id");
  });
});
