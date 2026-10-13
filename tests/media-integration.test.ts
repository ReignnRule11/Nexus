import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as block } from "@/app/api/users/[id]/block/route";
import { POST as createPost } from "@/app/api/posts/route";
import { GET as getPost, DELETE as deletePost } from "@/app/api/posts/[id]/route";
import { POST as initiateMedia } from "@/app/api/media/route";
import {
  DELETE as deleteMediaRoute,
  GET as getMedia,
} from "@/app/api/media/[id]/route";
import { POST as completeMedia } from "@/app/api/media/[id]/complete/route";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { mediaLimits } from "@/lib/media-policy";
import { setObjectStorageForTests, type ObjectStorage } from "@/lib/storage";
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

type JsonMedia = {
  media: {
    id: string;
    filename: string;
    mimeType: string;
    byteSize: number;
    status: string;
  };
  upload?: { url: string; method: string; headers: Record<string, string> };
  download?: { url: string; method: string; expiresAt: string };
};

type JsonPost = {
  post: {
    id: string;
    media: Array<{ id: string; filename: string; status: string }>;
  };
};

const routeContext = (id: string) => ({ params: Promise.resolve({ id }) });

function createTestStorage(): ObjectStorage & {
  objects: Map<string, { contentType: string; contentLength: number }>;
} {
  const objects = new Map<
    string,
    { contentType: string; contentLength: number }
  >();
  return {
    objects,
    async createUploadUrl(input) {
      objects.set(input.objectKey, {
        contentType: input.contentType,
        contentLength: input.contentLength,
      });
      return {
        url: `https://storage.test.upload/${input.objectKey}`,
        method: "PUT",
        headers: {
          "content-type": input.contentType,
          "content-length": String(input.contentLength),
        },
        expiresAt: new Date(Date.now() + 300_000),
      };
    },
    async createDownloadUrl(input) {
      return {
        url: `https://storage.test.download/${input.objectKey}`,
        method: "GET",
        expiresAt: new Date(Date.now() + 120_000),
      };
    },
    async headObject(objectKey) {
      const object = objects.get(objectKey);
      if (!object) {
        return null;
      }
      return {
        contentLength: object.contentLength,
        contentType: object.contentType,
        etag: "test-etag",
      };
    },
    async deleteObject(objectKey) {
      if (!objects.has(objectKey)) {
        return { deleted: false, missing: true };
      }
      objects.delete(objectKey);
      return { deleted: true, missing: false };
    },
  };
}

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
  "media PostgreSQL integration (blocked by environment)",
  () => {
    it("does not mutate PostgreSQL unless DATABASE_URL points at nexus_test", () => {
      expect(connectedDatabaseName === TEST_DATABASE_NAME).toBe(false);
    });
  },
);

describe.skipIf(!canRunIntegration)("media PostgreSQL integration", () => {
  const createdUserIds: string[] = [];
  let prisma: ReturnType<typeof getPrismaClient>;
  const storage = createTestStorage();

  beforeAll(() => {
    ensureTestAuthSecret();
    prisma = getPrismaClient();
    setObjectStorageForTests(storage);
  });

  afterEach(async () => {
    storage.objects.clear();
    if (!prisma || createdUserIds.length === 0) {
      return;
    }
    const ids = [...createdUserIds];
    createdUserIds.length = 0;
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  afterAll(async () => {
    setObjectStorageForTests(undefined);
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  async function registerAccount(overrides: Record<string, unknown> = {}) {
    const csrf = await issueCsrf();
    const payload = {
      email: uniqueEmail("m"),
      password: PASSWORD,
      username: uniqueUsername("m"),
      displayName: "Media User",
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

  async function uploadAvailable(cookies: string[], filename = "photo.jpg") {
    const start = await initiateMedia(
      await mutate(cookies, "/api/media", "POST", {
        filename,
        mimeType: "image/jpeg",
        byteSize: 12,
      }),
    );
    const started = (await start.json()) as JsonMedia;
    expect(start.status).toBe(201);
    const complete = await completeMedia(
      await mutate(cookies, `/api/media/${started.media.id}/complete`, "POST"),
      routeContext(started.media.id),
    );
    const completed = (await complete.json()) as JsonMedia;
    expect(complete.status).toBe(200);
    expect(completed.media.status).toBe("AVAILABLE");
    return completed.media;
  }

  it("creates pending media metadata with an opaque object key", async () => {
    const actor = await registerAccount();
    const response = await initiateMedia(
      await mutate(actor.cookies, "/api/media", "POST", {
        filename: "../../secret.png",
        mimeType: "image/png",
        byteSize: 24,
      }),
    );
    const body = (await response.json()) as JsonMedia;
    expect(response.status).toBe(201);
    expect(body.media.filename).toBe("secret.png");
    expect(body.upload?.method).toBe("PUT");
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("S3_SECRET");
    const stored = await prisma.media.findUnique({
      where: { id: body.media.id },
    });
    expect(stored?.objectKey).toMatch(
      /^media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(stored?.objectKey).not.toContain("secret.png");
    expect(stored?.status).toBe("PENDING");
  });

  it("rejects unauthenticated, CSRF-less, inactive, invalid MIME, and oversized uploads", async () => {
    const actor = await registerAccount();
    const anonymousCsrf = await issueCsrf();
    const unauthenticated = await initiateMedia(
      requestFor("/api/media", {
        method: "POST",
        cookies: anonymousCsrf.cookies,
        csrf: anonymousCsrf.token,
        body: { filename: "a.jpg", mimeType: "image/jpeg", byteSize: 12 },
      }),
    );
    expect(unauthenticated.status).toBe(401);

    const noCsrf = await initiateMedia(
      requestFor("/api/media", {
        method: "POST",
        cookies: actor.cookies,
        body: { filename: "a.jpg", mimeType: "image/jpeg", byteSize: 12 },
      }),
    );
    expect(noCsrf.status).toBe(403);

    const html = await initiateMedia(
      await mutate(actor.cookies, "/api/media", "POST", {
        filename: "page.html",
        mimeType: "text/html",
        byteSize: 12,
      }),
    );
    expect(html.status).toBe(400);

    const oversized = await initiateMedia(
      await mutate(actor.cookies, "/api/media", "POST", {
        filename: "big.jpg",
        mimeType: "image/jpeg",
        byteSize: mediaLimits.maxImageBytes + 1,
      }),
    );
    expect(oversized.status).toBe(400);

    await prisma.user.update({
      where: { id: actor.body.user.id },
      data: { status: "SUSPENDED" },
    });
    const suspended = await initiateMedia(
      await mutate(actor.cookies, "/api/media", "POST", {
        filename: "a.jpg",
        mimeType: "image/jpeg",
        byteSize: 12,
      }),
    );
    expect(suspended.status).toBe(403);
  });

  it("attaches owner media to posts and rejects cross-user or pending attachments", async () => {
    const owner = await registerAccount();
    const other = await registerAccount();
    const available = await uploadAvailable(owner.cookies);
    const pending = await initiateMedia(
      await mutate(owner.cookies, "/api/media", "POST", {
        filename: "pending.jpg",
        mimeType: "image/jpeg",
        byteSize: 12,
      }),
    );
    const pendingBody = (await pending.json()) as JsonMedia;
    const foreign = await uploadAvailable(other.cookies, "other.jpg");

    const created = await createPost(
      await mutate(owner.cookies, "/api/posts", "POST", {
        body: "with photo",
        mediaIds: [available.id],
      }),
    );
    const createdBody = (await created.json()) as JsonPost;
    expect(created.status).toBe(201);
    expect(createdBody.post.media.map((item) => item.id)).toEqual([available.id]);

    const tooMany = await createPost(
      await mutate(owner.cookies, "/api/posts", "POST", {
        body: "too many",
        mediaIds: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
          "33333333-3333-4333-8333-333333333333",
          "44444444-4444-4444-8444-444444444444",
          "55555555-5555-4555-8555-555555555555",
        ],
      }),
    );
    expect(tooMany.status).toBe(400);

    const pendingAttach = await createPost(
      await mutate(owner.cookies, "/api/posts", "POST", {
        body: "pending",
        mediaIds: [pendingBody.media.id],
      }),
    );
    expect(pendingAttach.status).toBe(400);

    const stolen = await createPost(
      await mutate(owner.cookies, "/api/posts", "POST", {
        body: "stolen",
        mediaIds: [foreign.id],
      }),
    );
    expect(stolen.status).toBe(403);
  });

  it("authorizes signed downloads and respects blocks, deletion, and anonymity", async () => {
    const owner = await registerAccount();
    const viewer = await registerAccount();
    const media = await uploadAvailable(owner.cookies);
    const created = await createPost(
      await mutate(owner.cookies, "/api/posts", "POST", {
        body: "visible",
        mediaIds: [media.id],
      }),
    );
    const createdBody = (await created.json()) as JsonPost;

    const allowed = await getMedia(
      requestFor(`/api/media/${media.id}`, {
        method: "GET",
        cookies: viewer.cookies,
      }),
      routeContext(media.id),
    );
    const allowedBody = (await allowed.json()) as JsonMedia;
    expect(allowed.status).toBe(200);
    expect(allowedBody.download?.method).toBe("GET");
    expect(JSON.stringify(allowedBody)).not.toContain("objectKey");
    expect(JSON.stringify(allowedBody)).not.toContain("password");

    const anonymous = await getMedia(
      requestFor(`/api/media/${media.id}`, { method: "GET" }),
      routeContext(media.id),
    );
    expect(anonymous.status).toBe(401);

    await block(
      await mutate(owner.cookies, `/api/users/${viewer.body.user.id}/block`, "POST"),
      routeContext(viewer.body.user.id),
    );
    const blocked = await getMedia(
      requestFor(`/api/media/${media.id}`, {
        method: "GET",
        cookies: viewer.cookies,
      }),
      routeContext(media.id),
    );
    expect(blocked.status).toBe(404);

    const deleteResponse = await deletePost(
      await mutate(
        owner.cookies,
        `/api/posts/${createdBody.post.id}`,
        "DELETE",
      ),
      routeContext(createdBody.post.id),
    );
    expect(deleteResponse.status).toBe(200);
    const afterPostDelete = await getMedia(
      requestFor(`/api/media/${media.id}`, {
        method: "GET",
        cookies: owner.cookies,
      }),
      routeContext(media.id),
    );
    expect(afterPostDelete.status).toBe(404);

    const fetchedPost = await getPost(
      requestFor(`/api/posts/${createdBody.post.id}`, {
        method: "GET",
        cookies: owner.cookies,
      }),
      routeContext(createdBody.post.id),
    );
    expect(fetchedPost.status).toBe(404);
  });

  it("deletes media metadata, prevents later access, and tolerates missing objects", async () => {
    const owner = await registerAccount();
    const other = await registerAccount();
    const media = await uploadAvailable(owner.cookies);
    const foreign = await deleteMediaRoute(
      await mutate(other.cookies, `/api/media/${media.id}`, "DELETE"),
      routeContext(media.id),
    );
    expect(foreign.status).toBe(403);

    const deleted = await deleteMediaRoute(
      await mutate(owner.cookies, `/api/media/${media.id}`, "DELETE"),
      routeContext(media.id),
    );
    const deletedBody = (await deleted.json()) as {
      mediaDeleted: boolean;
      objectRemoved: boolean;
    };
    expect(deleted.status).toBe(200);
    expect(deletedBody.mediaDeleted).toBe(true);
    const stored = await prisma.media.findUnique({ where: { id: media.id } });
    expect(stored?.status).toBe("DELETED");
    expect(stored?.deletedAt).not.toBeNull();

    const access = await getMedia(
      requestFor(`/api/media/${media.id}`, {
        method: "GET",
        cookies: owner.cookies,
      }),
      routeContext(media.id),
    );
    expect(access.status).toBe(404);

    const again = await deleteMediaRoute(
      await mutate(owner.cookies, `/api/media/${media.id}`, "DELETE"),
      routeContext(media.id),
    );
    expect(again.status).toBe(404);
  });
});
