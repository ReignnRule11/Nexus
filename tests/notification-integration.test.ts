import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as block } from "@/app/api/users/[id]/block/route";
import { POST as follow } from "@/app/api/users/[id]/follow/route";
import { POST as createPost } from "@/app/api/posts/route";
import { DELETE as deletePost } from "@/app/api/posts/[id]/route";
import { POST as createComment } from "@/app/api/posts/[id]/comments/route";
import {
  DELETE as removeReaction,
  POST as addReaction,
} from "@/app/api/posts/[id]/reactions/route";
import {
  POST as startConversation,
} from "@/app/api/conversations/route";
import { POST as sendMessage } from "@/app/api/conversations/[id]/messages/route";
import {
  GET as listCommunities,
  POST as createCommunity,
} from "@/app/api/communities/route";
import { POST as joinCommunity } from "@/app/api/communities/[id]/join/route";
import { PATCH as updateMemberRole } from "@/app/api/communities/[id]/members/[userId]/route";
import { GET as listNotifications } from "@/app/api/notifications/route";
import { GET as getUnreadCount } from "@/app/api/notifications/unread-count/route";
import { POST as markRead } from "@/app/api/notifications/[id]/read/route";
import { POST as markAllRead } from "@/app/api/notifications/read-all/route";
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

type JsonPost = { post: { id: string; body: string } };
type JsonComment = { comment: { id: string; postId: string } };
type JsonConversation = { conversation: { id: string } };
type JsonCommunity = {
  community: { id: string; visibility: string; viewerRole: string | null };
};

type JsonNotification = {
  id: string;
  type: string;
  createdAt: string;
  readAt: string | null;
  actor: { userId: string; username: string } | null;
  target: {
    postId: string | null;
    commentId: string | null;
    conversationId: string | null;
    messageId: string | null;
    communityId: string | null;
  };
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
  "notifications PostgreSQL integration (blocked by environment)",
  () => {
    it("does not mutate PostgreSQL unless DATABASE_URL points at nexus_test", () => {
      expect(connectedDatabaseName === TEST_DATABASE_NAME).toBe(false);
    });
  },
);

describe.skipIf(!canRunIntegration)("notifications PostgreSQL integration", () => {
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

  async function registerAccount(prefix = "ntf") {
    const csrf = await issueCsrf();
    const response = await register(
      requestFor("/api/auth/register", {
        method: "POST",
        cookies: csrf.cookies,
        csrf: csrf.token,
        body: {
          email: uniqueEmail(prefix),
          password: PASSWORD,
          username: uniqueUsername(prefix),
          displayName: "Notification User",
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

  async function list(
    cookies: string[],
    query = "",
  ): Promise<{ status: number; body: JsonPage<JsonNotification> }> {
    const response = await listNotifications(
      requestFor(`/api/notifications${query}`, {
        method: "GET",
        cookies,
      }),
    );
    return {
      status: response.status,
      body: (await response.json()) as JsonPage<JsonNotification>,
    };
  }

  async function unread(cookies: string[]): Promise<number> {
    const response = await getUnreadCount(
      requestFor("/api/notifications/unread-count", {
        method: "GET",
        cookies,
      }),
    );
    const body = (await response.json()) as { unreadCount: number };
    return body.unreadCount;
  }

  async function followAs(from: string[], targetId: string) {
    return follow(
      await mutate(from, `/api/users/${targetId}/follow`, "POST"),
      routeContext(targetId),
    );
  }

  async function createOwnPost(cookies: string[]): Promise<string> {
    const response = await createPost(
      await mutate(cookies, "/api/posts", "POST", { body: "hello world" }),
    );
    const body = (await response.json()) as JsonPost;
    expect(response.status).toBe(201);
    return body.post.id;
  }

  function uniqueSlug(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function createCommunityAs(cookies: string[]): Promise<JsonCommunity["community"]> {
    const response = await createCommunity(
      await mutate(cookies, "/api/communities", "POST", {
        name: `Notify ${uniqueSlug("g")}`,
        slug: uniqueSlug("n"),
      }),
    );
    expect(response.status).toBe(201);
    return ((await response.json()) as JsonCommunity).community;
  }

  it("creates a FOLLOW notification once and suppresses self/duplicate/blocked follows", async () => {
    const alice = await registerAccount("fol");
    const bob = await registerAccount("fol");

    const self = await followAs(alice.cookies, alice.user.id);
    expect(self.status).toBe(400);
    expect(
      await prisma.notification.count({
        where: { recipientId: alice.user.id, type: "FOLLOW" },
      }),
    ).toBe(0);

    const first = await followAs(alice.cookies, bob.user.id);
    expect(first.status).toBe(200);
    const second = await followAs(alice.cookies, bob.user.id);
    expect(second.status).toBe(200);

    const rows = await prisma.notification.findMany({
      where: { recipientId: bob.user.id, type: "FOLLOW" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(alice.user.id);
    expect(rows[0]?.eventKey.startsWith("follow:")).toBe(true);

    const blockedNotified = await registerAccount("fol");
    const blockedActor = await registerAccount("fol");
    const blockResponse = await block(
      await mutate(
        blockedNotified.cookies,
        `/api/users/${blockedActor.user.id}/block`,
        "POST",
      ),
      routeContext(blockedActor.user.id),
    );
    expect(blockResponse.status).toBe(200);
    const blockedFollow = await followAs(blockedActor.cookies, blockedNotified.user.id);
    expect(blockedFollow.status).toBe(403);
    expect(
      await prisma.notification.count({
        where: { recipientId: blockedNotified.user.id, type: "FOLLOW" },
      }),
    ).toBe(0);
  });

  it("creates COMMENT notifications except for self-comments and deleted posts", async () => {
    const author = await registerAccount("cmt");
    const commenter = await registerAccount("cmt");
    const postId = await createOwnPost(author.cookies);

    const comment = await createComment(
      await mutate(commenter.cookies, `/api/posts/${postId}/comments`, "POST", {
        body: "nice post",
      }),
      routeContext(postId),
    );
    const commentBody = (await comment.json()) as JsonComment;
    expect(comment.status).toBe(201);

    const rows = await prisma.notification.findMany({
      where: { recipientId: author.user.id, type: "COMMENT" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.postId).toBe(postId);
    expect(rows[0]?.commentId).toBe(commentBody.comment.id);
    expect(rows[0]?.actorId).toBe(commenter.user.id);

    const selfComment = await createComment(
      await mutate(author.cookies, `/api/posts/${postId}/comments`, "POST", {
        body: "self reply",
      }),
      routeContext(postId),
    );
    expect(selfComment.status).toBe(201);
    expect(
      await prisma.notification.count({
        where: { recipientId: author.user.id, type: "COMMENT" },
      }),
    ).toBe(1);

    const removed = await deletePost(
      await mutate(author.cookies, `/api/posts/${postId}`, "DELETE"),
      routeContext(postId),
    );
    expect(removed.status).toBe(200);
    const afterDelete = await createComment(
      await mutate(commenter.cookies, `/api/posts/${postId}/comments`, "POST", {
        body: "too late",
      }),
      routeContext(postId),
    );
    expect(afterDelete.status).toBe(404);
    expect(
      await prisma.notification.count({
        where: { recipientId: author.user.id, type: "COMMENT" },
      }),
    ).toBe(1);
  });

  it("creates REACTION notifications once and none when a reaction is removed", async () => {
    const author = await registerAccount("rea");
    const reactor = await registerAccount("rea");
    const postId = await createOwnPost(author.cookies);

    const first = await addReaction(
      await mutate(reactor.cookies, `/api/posts/${postId}/reactions`, "POST", {}),
      routeContext(postId),
    );
    expect(first.status).toBe(200);
    const duplicate = await addReaction(
      await mutate(reactor.cookies, `/api/posts/${postId}/reactions`, "POST", {}),
      routeContext(postId),
    );
    expect(duplicate.status).toBe(200);

    expect(
      await prisma.notification.count({
        where: { recipientId: author.user.id, type: "REACTION" },
      }),
    ).toBe(1);

    const selfReaction = await addReaction(
      await mutate(author.cookies, `/api/posts/${postId}/reactions`, "POST", {}),
      routeContext(postId),
    );
    expect(selfReaction.status).toBe(200);
    expect(
      await prisma.notification.count({
        where: { recipientId: author.user.id, type: "REACTION" },
      }),
    ).toBe(1);

    const removed = await removeReaction(
      await mutate(reactor.cookies, `/api/posts/${postId}/reactions`, "DELETE"),
      routeContext(postId),
    );
    expect(removed.status).toBe(200);
    expect(
      await prisma.notification.count({
        where: { recipientId: author.user.id, type: "REACTION" },
      }),
    ).toBe(1);
  });

  it("notifies only the 1:1 message recipient without exposing message bodies", async () => {
    const alice = await registerAccount("msg");
    const bob = await registerAccount("msg");

    const started = await startConversation(
      await mutate(alice.cookies, "/api/conversations", "POST", {
        userId: bob.user.id,
      }),
    );
    const conversation = ((await started.json()) as JsonConversation).conversation;

    const sent = await sendMessage(
      await mutate(
        alice.cookies,
        `/api/conversations/${conversation.id}/messages`,
        "POST",
        { body: "secret-message-body" },
      ),
      routeContext(conversation.id),
    );
    expect(sent.status).toBe(201);

    const bobRows = await prisma.notification.findMany({
      where: { recipientId: bob.user.id, type: "MESSAGE" },
    });
    expect(bobRows).toHaveLength(1);
    expect(bobRows[0]?.conversationId).toBe(conversation.id);
    expect(bobRows[0]?.messageId).toBeTruthy();
    expect(
      await prisma.notification.count({
        where: { recipientId: alice.user.id, type: "MESSAGE" },
      }),
    ).toBe(0);

    const payload = await list(bob.cookies);
    const serialized = JSON.stringify(payload.body);
    expect(serialized).not.toContain("secret-message-body");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("token");

    const blocked = await registerAccount("msg");
    const blockedStart = await startConversation(
      await mutate(alice.cookies, "/api/conversations", "POST", {
        userId: blocked.user.id,
      }),
    );
    const blockedConversation = ((await blockedStart.json()) as JsonConversation)
      .conversation;
    await block(
      await mutate(blocked.cookies, `/api/users/${alice.user.id}/block`, "POST"),
      routeContext(alice.user.id),
    );
    const blockedSend = await sendMessage(
      await mutate(
        alice.cookies,
        `/api/conversations/${blockedConversation.id}/messages`,
        "POST",
        { body: "blocked" },
      ),
      routeContext(blockedConversation.id),
    );
    expect(blockedSend.status).toBe(404);
    expect(
      await prisma.notification.count({
        where: { recipientId: blocked.user.id, type: "MESSAGE" },
      }),
    ).toBe(0);
  });

  it("notifies community staff on public joins without notifying the joiner", async () => {
    const owner = await registerAccount("com");
    const admin = await registerAccount("com");
    const joiner = await registerAccount("com");
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

    const join = await joinCommunity(
      await mutate(joiner.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );
    expect(join.status).toBe(200);

    const ownerRows = await prisma.notification.findMany({
      where: {
        recipientId: owner.user.id,
        type: "COMMUNITY_MEMBER_JOINED",
        actorId: joiner.user.id,
      },
    });
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]?.communityId).toBe(community.id);
    expect(ownerRows[0]?.actorId).toBe(joiner.user.id);

    expect(
      await prisma.notification.count({
        where: {
          recipientId: admin.user.id,
          type: "COMMUNITY_MEMBER_JOINED",
          actorId: joiner.user.id,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { recipientId: joiner.user.id },
      }),
    ).toBe(0);

    const repeated = await joinCommunity(
      await mutate(joiner.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );
    expect(repeated.status).toBe(200);
    expect(
      await prisma.notification.count({
        where: {
          recipientId: owner.user.id,
          type: "COMMUNITY_MEMBER_JOINED",
          actorId: joiner.user.id,
        },
      }),
    ).toBe(1);
  });

  it("notifies role changes once and preserves private-community privacy", async () => {
    const owner = await registerAccount("rol");
    const member = await registerAccount("rol");
    const outsider = await registerAccount("rol");
    const community = await createCommunityAs(owner.cookies);
    await joinCommunity(
      await mutate(member.cookies, `/api/communities/${community.id}/join`, "POST"),
      routeContext(community.id),
    );

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

    const rows = await prisma.notification.findMany({
      where: { recipientId: member.user.id, type: "COMMUNITY_ROLE_CHANGED" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(owner.user.id);
    expect(rows[0]?.communityId).toBe(community.id);

    const repeat = await updateMemberRole(
      await mutate(
        owner.cookies,
        `/api/communities/${community.id}/members/${member.user.id}`,
        "PATCH",
        { role: "ADMIN" },
      ),
      memberContext(community.id, member.user.id),
    );
    expect(repeat.status).toBe(200);
    expect(
      await prisma.notification.count({
        where: { recipientId: member.user.id, type: "COMMUNITY_ROLE_CHANGED" },
      }),
    ).toBe(1);

    const privateCommunity = await createCommunity(
      await mutate(owner.cookies, "/api/communities", "POST", {
        name: `Private ${uniqueSlug("p")}`,
        slug: uniqueSlug("p"),
        visibility: "PRIVATE",
      }),
    );
    const privateBody = (await privateCommunity.json()) as JsonCommunity;
    const privateJoin = await joinCommunity(
      await mutate(
        outsider.cookies,
        `/api/communities/${privateBody.community.id}/join`,
        "POST",
      ),
      routeContext(privateBody.community.id),
    );
    expect(privateJoin.status).toBe(404);
    expect(
      await prisma.notification.count({
        where: {
          recipientId: owner.user.id,
          type: "COMMUNITY_MEMBER_JOINED",
          communityId: privateBody.community.id,
        },
      }),
    ).toBe(0);

    const outsiderList = await listCommunities(
      requestFor("/api/communities", {
        method: "GET",
        cookies: outsider.cookies,
      }),
    );
    const discovery = (await outsiderList.json()) as JsonPage<{ id: string }>;
    expect(
      discovery.items.some((item) => item.id === privateBody.community.id),
    ).toBe(false);
  });

  it("tracks unread counts, marks single and all notifications, and stays idempotent", async () => {
    const target = await registerAccount("red");
    const firstActor = await registerAccount("red");
    const secondActor = await registerAccount("red");

    await followAs(firstActor.cookies, target.user.id);
    await followAs(secondActor.cookies, target.user.id);

    expect(await unread(target.cookies)).toBe(2);

    const page = await list(target.cookies);
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(2);
    expect(page.body.items.every((item) => item.readAt === null)).toBe(true);

    const notificationId = page.body.items[0]!.id;
    const mark = await markRead(
      await mutate(
        target.cookies,
        `/api/notifications/${notificationId}/read`,
        "POST",
      ),
      routeContext(notificationId),
    );
    expect(mark.status).toBe(200);
    const markBody = (await mark.json()) as { readAt: string };
    expect(typeof markBody.readAt).toBe("string");

    const repeat = await markRead(
      await mutate(
        target.cookies,
        `/api/notifications/${notificationId}/read`,
        "POST",
      ),
      routeContext(notificationId),
    );
    expect(repeat.status).toBe(200);
    expect(await unread(target.cookies)).toBe(1);

    const all = await markAllRead(
      await mutate(target.cookies, "/api/notifications/read-all", "POST"),
    );
    expect(all.status).toBe(200);
    expect(await unread(target.cookies)).toBe(0);

    const allAgain = await markAllRead(
      await mutate(target.cookies, "/api/notifications/read-all", "POST"),
    );
    expect(allAgain.status).toBe(200);
    expect(((await allAgain.json()) as { updated: number }).updated).toBe(0);
  });

  it("paginates notifications newest first with a deterministic cursor", async () => {
    const target = await registerAccount("pag");
    const actors = await Promise.all([
      registerAccount("pag"),
      registerAccount("pag"),
      registerAccount("pag"),
    ]);
    for (const actor of actors) {
      await followAs(actor.cookies, target.user.id);
    }

    const pageOne = await list(target.cookies, "?limit=2");
    expect(pageOne.body.items).toHaveLength(2);
    expect(pageOne.body.nextCursor).toBeTruthy();

    const pageTwo = await list(
      target.cookies,
      `?limit=2&cursor=${encodeURIComponent(pageOne.body.nextCursor as string)}`,
    );
    expect(pageTwo.body.items).toHaveLength(1);
    expect(pageTwo.body.nextCursor).toBeNull();

    const ids = [...pageOne.body.items, ...pageTwo.body.items].map(
      (item) => item.id,
    );
    expect(new Set(ids).size).toBe(3);
    const timestamps = [...pageOne.body.items, ...pageTwo.body.items].map(
      (item) => Date.parse(item.createdAt),
    );
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);

    const badCursor = await list(target.cookies, "?cursor=!!!not-base64!!!");
    expect(badCursor.status).toBe(400);
    const badLimit = await list(target.cookies, "?limit=0");
    expect(badLimit.status).toBe(400);
  });

  it("enforces ownership, authentication, CSRF, and applies current block/deletion rules", async () => {
    const target = await registerAccount("sec");
    const actor = await registerAccount("sec");
    const outsider = await registerAccount("sec");
    await followAs(actor.cookies, target.user.id);

    const page = await list(target.cookies);
    const notification = page.body.items[0]!;

    const foreignMark = await markRead(
      await mutate(
        outsider.cookies,
        `/api/notifications/${notification.id}/read`,
        "POST",
      ),
      routeContext(notification.id),
    );
    expect(foreignMark.status).toBe(404);

    const anonymousList = await listNotifications(
      new Request(`${ORIGIN}/api/notifications`),
    );
    expect(anonymousList.status).toBe(401);
    const anonymousCount = await getUnreadCount(
      new Request(`${ORIGIN}/api/notifications/unread-count`),
    );
    expect(anonymousCount.status).toBe(401);

    const noCsrf = await markAllRead(
      requestFor("/api/notifications/read-all", {
        method: "POST",
        cookies: target.cookies,
      }),
    );
    expect(noCsrf.status).toBe(403);

    await block(
      await mutate(target.cookies, `/api/users/${actor.user.id}/block`, "POST"),
      routeContext(actor.user.id),
    );
    const afterBlock = await list(target.cookies);
    expect(afterBlock.body.items).toHaveLength(0);
    expect(await unread(target.cookies)).toBe(0);

    const deletedActor = await registerAccount("sec");
    const deletedTarget = await registerAccount("sec");
    await followAs(deletedActor.cookies, deletedTarget.user.id);
    await prisma.user.update({
      where: { id: deletedActor.user.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    const deletedList = await list(deletedTarget.cookies);
    expect(deletedList.body.items).toHaveLength(0);

    await prisma.user.update({
      where: { id: target.user.id },
      data: { status: "SUSPENDED" },
    });
    const suspendedList = await list(target.cookies);
    expect(suspendedList.status).toBe(403);
  });

  it("collapses concurrent duplicate events into one notification", async () => {
    const target = await registerAccount("con");
    const actor = await registerAccount("con");
    const csrf = await issueCsrf(actor.cookies);

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        follow(
          requestFor(`/api/users/${target.user.id}/follow`, {
            method: "POST",
            cookies: actor.cookies,
            csrf: csrf.token,
          }),
          routeContext(target.user.id),
        ),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(
      await prisma.notification.count({
        where: { recipientId: target.user.id, type: "FOLLOW" },
      }),
    ).toBe(1);

    const joiner = await registerAccount("con");
    const community = await createCommunityAs(target.cookies);
    const joinCsrf = await issueCsrf(joiner.cookies);
    const joins = await Promise.all(
      Array.from({ length: 4 }, () =>
        joinCommunity(
          requestFor(`/api/communities/${community.id}/join`, {
            method: "POST",
            cookies: joiner.cookies,
            csrf: joinCsrf.token,
          }),
          routeContext(community.id),
        ),
      ),
    );
    expect(joins.every((response) => response.status === 200)).toBe(true);
    expect(
      await prisma.notification.count({
        where: {
          recipientId: target.user.id,
          type: "COMMUNITY_MEMBER_JOINED",
          actorId: joiner.user.id,
        },
      }),
    ).toBe(1);
  });

  it("does not leak sensitive fields through notification payloads", async () => {
    const target = await registerAccount("leak");
    const actor = await registerAccount("leak");
    await followAs(actor.cookies, target.user.id);

    const response = await list(target.cookies);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("emailNormalized");
    expect(serialized).not.toContain("recipientId");
    expect(serialized).not.toContain("eventKey");
    expect(serialized).not.toContain("actorId");
  });
});
