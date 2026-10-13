import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as follow } from "@/app/api/users/[id]/follow/route";
import { POST as block } from "@/app/api/users/[id]/block/route";
import { POST as createPost } from "@/app/api/posts/route";
import {
  DELETE as deletePost,
  GET as getPost,
  PATCH as patchPost,
} from "@/app/api/posts/[id]/route";
import { GET as getFeed } from "@/app/api/feed/route";
import {
  GET as listComments,
  POST as createComment,
} from "@/app/api/posts/[id]/comments/route";
import {
  DELETE as deleteComment,
  PATCH as patchComment,
} from "@/app/api/comments/[id]/route";
import {
  DELETE as removeReaction,
  POST as addReaction,
} from "@/app/api/posts/[id]/reactions/route";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { POST_VISIBILITY } from "@/lib/posts";
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

type JsonPost = {
  post: {
    id: string;
    author: { userId: string; username: string };
    body: string;
    createdAt: string;
    updatedAt: string;
    commentCount: number;
    reactionCount: number;
    viewerHasLiked: boolean;
  };
};

type JsonComment = {
  comment: {
    id: string;
    postId: string;
    author: { userId: string; username: string };
    body: string;
  };
};

type JsonPage<T> = {
  items: T[];
  nextCursor: string | null;
};

type JsonReaction = {
  reactionCount: number;
  viewerHasLiked: boolean;
  type: string;
};

type JsonError = {
  error: { code: string; message: string; fields?: Record<string, string> };
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
  "posts PostgreSQL integration (blocked by environment)",
  () => {
    it("does not mutate PostgreSQL unless DATABASE_URL points at nexus_test", () => {
      expect(connectedDatabaseName === TEST_DATABASE_NAME).toBe(false);
    });
  },
);

describe.skipIf(!canRunIntegration)("posts PostgreSQL integration", () => {
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
      email: uniqueEmail("p"),
      password: PASSWORD,
      username: uniqueUsername("p"),
      displayName: "Post User",
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
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ) {
    const csrf = await issueCsrf(cookies);
    return requestFor(path, { method, cookies, csrf: csrf.token, body });
  }

  async function followUser(actorCookies: string[], targetId: string) {
    const request = await mutate(
      actorCookies,
      `/api/users/${targetId}/follow`,
      "POST",
    );
    return follow(request, routeContext(targetId));
  }

  async function blockUser(actorCookies: string[], targetId: string) {
    const request = await mutate(
      actorCookies,
      `/api/users/${targetId}/block`,
      "POST",
    );
    return block(request, routeContext(targetId));
  }

  async function publishPost(cookies: string[], body: string) {
    const request = await mutate(cookies, "/api/posts", "POST", { body });
    const response = await createPost(request);
    const payload = (await response.json()) as JsonPost & JsonError;
    return { response, payload };
  }

  it("documents chronological feed visibility", () => {
    expect(POST_VISIBILITY.feed).toMatch(/createdAt DESC/);
    expect(POST_VISIBILITY.blocks).toMatch(/Block filtering is enforced server-side/);
  });

  it("creates, reads, updates, and soft-deletes a post as the owner", async () => {
    const actor = await registerAccount({ displayName: "Ada" });
    const created = await publishPost(actor.cookies, "Hello Nexus");
    expect(created.response.status).toBe(201);
    expect(created.payload.post.body).toBe("Hello Nexus");
    expect(created.payload.post.author.userId).toBe(actor.body.user.id);
    expect(JSON.stringify(created.payload)).not.toContain("password");
    expect(JSON.stringify(created.payload)).not.toContain("tokenHash");
    expect(JSON.stringify(created.payload)).not.toContain("email");

    const postId = created.payload.post.id;
    const fetched = await getPost(
      requestFor(`/api/posts/${postId}`, {
        method: "GET",
        cookies: actor.cookies,
      }),
      routeContext(postId),
    );
    const fetchedBody = (await fetched.json()) as JsonPost;
    expect(fetched.status).toBe(200);
    expect(fetchedBody.post.body).toBe("Hello Nexus");

    const updateRequest = await mutate(
      actor.cookies,
      `/api/posts/${postId}`,
      "PATCH",
      { body: "Updated body" },
    );
    const updated = await patchPost(updateRequest, routeContext(postId));
    const updatedBody = (await updated.json()) as JsonPost;
    expect(updated.status).toBe(200);
    expect(updatedBody.post.body).toBe("Updated body");

    const deleteRequest = await mutate(
      actor.cookies,
      `/api/posts/${postId}`,
      "DELETE",
    );
    const deleted = await deletePost(deleteRequest, routeContext(postId));
    expect(deleted.status).toBe(200);
    const stored = await prisma.post.findUnique({ where: { id: postId } });
    expect(stored?.deletedAt).not.toBeNull();

    const missing = await getPost(
      requestFor(`/api/posts/${postId}`, {
        method: "GET",
        cookies: actor.cookies,
      }),
      routeContext(postId),
    );
    expect(missing.status).toBe(404);
  });

  it("rejects blank posts, non-owners, CSRF-less mutations, and unauthenticated creates", async () => {
    const actor = await registerAccount();
    const other = await registerAccount();
    const blank = await publishPost(actor.cookies, "   ");
    expect(blank.response.status).toBe(400);

    const created = await publishPost(actor.cookies, "Owned post");
    const postId = created.payload.post.id;

    const foreignRequest = await mutate(
      other.cookies,
      `/api/posts/${postId}`,
      "PATCH",
      { body: "hijack" },
    );
    const foreign = await patchPost(foreignRequest, routeContext(postId));
    expect(foreign.status).toBe(403);

    const noCsrf = await createPost(
      requestFor("/api/posts", {
        method: "POST",
        cookies: actor.cookies,
        body: { body: "no csrf" },
      }),
    );
    expect(noCsrf.status).toBe(403);

    const anonymousCsrf = await issueCsrf();
    const unauthenticated = await createPost(
      requestFor("/api/posts", {
        method: "POST",
        cookies: anonymousCsrf.cookies,
        csrf: anonymousCsrf.token,
        body: { body: "anon" },
      }),
    );
    expect(unauthenticated.status).toBe(401);
  });

  it("returns a chronological feed of own and following posts, excluding blocked and deleted", async () => {
    const viewer = await registerAccount({ displayName: "Viewer" });
    const followed = await registerAccount({ displayName: "Followed" });
    const stranger = await registerAccount({ displayName: "Stranger" });
    const blockedUser = await registerAccount({ displayName: "Blocked" });

    await followUser(viewer.cookies, followed.body.user.id);
    await blockUser(viewer.cookies, blockedUser.body.user.id);

    const own = await publishPost(viewer.cookies, "own post");
    const followedPost = await publishPost(followed.cookies, "followed post");
    await publishPost(stranger.cookies, "stranger post");
    await publishPost(blockedUser.cookies, "blocked post");

    const deletedFollowed = await publishPost(followed.cookies, "gone");
    await prisma.post.update({
      where: { id: own.payload.post.id },
      data: { createdAt: new Date("2026-10-13T00:00:01.000Z") },
    });
    await prisma.post.update({
      where: { id: followedPost.payload.post.id },
      data: { createdAt: new Date("2026-10-13T00:00:02.000Z") },
    });
    const deleteRequest = await mutate(
      followed.cookies,
      `/api/posts/${deletedFollowed.payload.post.id}`,
      "DELETE",
    );
    await deletePost(
      deleteRequest,
      routeContext(deletedFollowed.payload.post.id),
    );

    const feed = await getFeed(
      requestFor("/api/feed", { method: "GET", cookies: viewer.cookies }),
    );
    const feedBody = (await feed.json()) as JsonPage<JsonPost["post"]>;
    expect(feed.status).toBe(200);
    const bodies = feedBody.items.map((item) => item.body);
    expect(bodies).toContain("own post");
    expect(bodies).toContain("followed post");
    expect(bodies).not.toContain("stranger post");
    expect(bodies).not.toContain("blocked post");
    expect(bodies).not.toContain("gone");
    expect(feedBody.items[0]?.id).toBe(followedPost.payload.post.id);
    expect(feedBody.items[1]?.id).toBe(own.payload.post.id);
    expect(JSON.stringify(feedBody)).not.toContain("passwordHash");
  });

  it("paginates the feed with opaque createdAt,id cursors", async () => {
    const actor = await registerAccount();
    const first = await publishPost(actor.cookies, "older");
    const second = await publishPost(actor.cookies, "newer");
    await prisma.post.update({
      where: { id: first.payload.post.id },
      data: { createdAt: new Date("2026-10-13T00:00:01.000Z") },
    });
    await prisma.post.update({
      where: { id: second.payload.post.id },
      data: { createdAt: new Date("2026-10-13T00:00:02.000Z") },
    });

    const pageOne = await getFeed(
      requestFor("/api/feed?limit=1", {
        method: "GET",
        cookies: actor.cookies,
      }),
    );
    const firstBody = (await pageOne.json()) as JsonPage<JsonPost["post"]>;
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.items[0]?.id).toBe(second.payload.post.id);
    expect(firstBody.nextCursor).toBeTruthy();

    const pageTwo = await getFeed(
      requestFor(
        `/api/feed?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
        { method: "GET", cookies: actor.cookies },
      ),
    );
    const secondBody = (await pageTwo.json()) as JsonPage<JsonPost["post"]>;
    expect(secondBody.items[0]?.id).toBe(first.payload.post.id);
  });

  it("hides blocked authors' posts from the other party", async () => {
    const actor = await registerAccount();
    const target = await registerAccount();
    const actorPost = await publishPost(actor.cookies, "actor post");
    const targetPost = await publishPost(target.cookies, "target post");
    await blockUser(actor.cookies, target.body.user.id);

    const hiddenTarget = await getPost(
      requestFor(`/api/posts/${targetPost.payload.post.id}`, {
        method: "GET",
        cookies: actor.cookies,
      }),
      routeContext(targetPost.payload.post.id),
    );
    expect(hiddenTarget.status).toBe(404);

    const hiddenActor = await getPost(
      requestFor(`/api/posts/${actorPost.payload.post.id}`, {
        method: "GET",
        cookies: target.cookies,
      }),
      routeContext(actorPost.payload.post.id),
    );
    expect(hiddenActor.status).toBe(404);

    const own = await getPost(
      requestFor(`/api/posts/${targetPost.payload.post.id}`, {
        method: "GET",
        cookies: target.cookies,
      }),
      routeContext(targetPost.payload.post.id),
    );
    expect(own.status).toBe(200);
  });

  it("creates, lists, updates, and soft-deletes comments", async () => {
    const author = await registerAccount();
    const commenter = await registerAccount();
    const created = await publishPost(author.cookies, "thread");
    const postId = created.payload.post.id;

    const commentRequest = await mutate(
      commenter.cookies,
      `/api/posts/${postId}/comments`,
      "POST",
      { body: "first comment" },
    );
    const commentResponse = await createComment(
      commentRequest,
      routeContext(postId),
    );
    const commentBody = (await commentResponse.json()) as JsonComment;
    expect(commentResponse.status).toBe(201);
    expect(commentBody.comment.body).toBe("first comment");
    expect(JSON.stringify(commentBody)).not.toContain("password");

    const listed = await listComments(
      requestFor(`/api/posts/${postId}/comments`, {
        method: "GET",
        cookies: author.cookies,
      }),
      routeContext(postId),
    );
    const listedBody = (await listed.json()) as JsonPage<JsonComment["comment"]>;
    expect(listedBody.items).toHaveLength(1);

    const updateRequest = await mutate(
      commenter.cookies,
      `/api/comments/${commentBody.comment.id}`,
      "PATCH",
      { body: "edited comment" },
    );
    const updated = await patchComment(
      updateRequest,
      routeContext(commentBody.comment.id),
    );
    const updatedBody = (await updated.json()) as JsonComment;
    expect(updated.status).toBe(200);
    expect(updatedBody.comment.body).toBe("edited comment");

    const foreignRequest = await mutate(
      author.cookies,
      `/api/comments/${commentBody.comment.id}`,
      "PATCH",
      { body: "not yours" },
    );
    const foreign = await patchComment(
      foreignRequest,
      routeContext(commentBody.comment.id),
    );
    expect(foreign.status).toBe(403);

    const deleteRequest = await mutate(
      commenter.cookies,
      `/api/comments/${commentBody.comment.id}`,
      "DELETE",
    );
    const deleted = await deleteComment(
      deleteRequest,
      routeContext(commentBody.comment.id),
    );
    expect(deleted.status).toBe(200);
    const stored = await prisma.comment.findUnique({
      where: { id: commentBody.comment.id },
    });
    expect(stored?.deletedAt).not.toBeNull();

    const listedAfter = await listComments(
      requestFor(`/api/posts/${postId}/comments`, {
        method: "GET",
        cookies: author.cookies,
      }),
      routeContext(postId),
    );
    const afterBody = (await listedAfter.json()) as JsonPage<
      JsonComment["comment"]
    >;
    expect(afterBody.items).toHaveLength(0);
  });

  it("adds and removes LIKE reactions idempotently with uniqueness", async () => {
    const author = await registerAccount();
    const liker = await registerAccount();
    const created = await publishPost(author.cookies, "reactable");
    const postId = created.payload.post.id;

    const firstRequest = await mutate(
      liker.cookies,
      `/api/posts/${postId}/reactions`,
      "POST",
      { type: "LIKE" },
    );
    const first = await addReaction(firstRequest, routeContext(postId));
    const firstBody = (await first.json()) as JsonReaction;
    expect(first.status).toBe(200);
    expect(firstBody.viewerHasLiked).toBe(true);
    expect(firstBody.reactionCount).toBe(1);

    const secondRequest = await mutate(
      liker.cookies,
      `/api/posts/${postId}/reactions`,
      "POST",
      {},
    );
    const second = await addReaction(secondRequest, routeContext(postId));
    const secondBody = (await second.json()) as JsonReaction;
    expect(second.status).toBe(200);
    expect(secondBody.reactionCount).toBe(1);
    expect(
      await prisma.reaction.count({
        where: { postId, userId: liker.body.user.id, type: "LIKE" },
      }),
    ).toBe(1);

    await expect(
      prisma.reaction.create({
        data: { postId, userId: liker.body.user.id, type: "LIKE" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    const removeRequest = await mutate(
      liker.cookies,
      `/api/posts/${postId}/reactions`,
      "DELETE",
      { type: "LIKE" },
    );
    const removed = await removeReaction(removeRequest, routeContext(postId));
    const removedBody = (await removed.json()) as JsonReaction;
    expect(removed.status).toBe(200);
    expect(removedBody.viewerHasLiked).toBe(false);
    expect(removedBody.reactionCount).toBe(0);
  });

  it("rejects feed access without a session", async () => {
    const response = await getFeed(
      requestFor("/api/feed", { method: "GET" }),
    );
    expect(response.status).toBe(401);
  });
});
