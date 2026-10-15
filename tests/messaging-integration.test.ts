import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as block } from "@/app/api/users/[id]/block/route";
import { POST as initiateMedia } from "@/app/api/media/route";
import { POST as completeMedia } from "@/app/api/media/[id]/complete/route";
import { GET as getMedia } from "@/app/api/media/[id]/route";
import {
  GET as listConversations,
  POST as startConversation,
} from "@/app/api/conversations/route";
import {
  DELETE as hideConversation,
  GET as getConversation,
} from "@/app/api/conversations/[id]/route";
import {
  GET as listMessages,
  POST as sendMessage,
} from "@/app/api/conversations/[id]/messages/route";
import { POST as markRead } from "@/app/api/conversations/[id]/read/route";
import {
  DELETE as deleteMessage,
  PATCH as editMessage,
} from "@/app/api/messages/[id]/route";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
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
    profile: { username: string; displayName: string; bio: string | null };
  };
};

type JsonConversation = {
  conversation: {
    id: string;
    participants: Array<{ userId: string }>;
    otherParticipant: { userId: string } | null;
    unreadCount: number;
    lastMessage: JsonMessageBody | null;
  };
  created?: boolean;
};

type JsonMessageBody = {
  id: string;
  conversationId: string;
  body: string | null;
  deleted: boolean;
  edited: boolean;
  media: Array<{ id: string }>;
  sender: { userId: string } | null;
};

const routeContext = (id: string) => ({ params: Promise.resolve({ id }) });

function createTestStorage(): ObjectStorage {
  const objects = new Map<
    string,
    { contentType: string; contentLength: number }
  >();
  return {
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
  "messaging PostgreSQL integration (blocked by environment)",
  () => {
    it("does not mutate PostgreSQL unless DATABASE_URL points at nexus_test", () => {
      expect(connectedDatabaseName === TEST_DATABASE_NAME).toBe(false);
    });
  },
);

describe.skipIf(!canRunIntegration)("messaging PostgreSQL integration", () => {
  const createdUserIds: string[] = [];
  let prisma: ReturnType<typeof getPrismaClient>;

  beforeAll(() => {
    ensureTestAuthSecret();
    prisma = getPrismaClient();
    setObjectStorageForTests(createTestStorage());
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
    setObjectStorageForTests(undefined);
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  async function registerAccount() {
    const csrf = await issueCsrf();
    const payload = {
      email: uniqueEmail("msg"),
      password: PASSWORD,
      username: uniqueUsername("msg"),
      displayName: "Messaging User",
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

  async function openConversation(
    cookies: string[],
    otherUserId: string,
  ): Promise<JsonConversation> {
    const response = await startConversation(
      await mutate(cookies, "/api/conversations", "POST", {
        userId: otherUserId,
      }),
    );
    expect([200, 201]).toContain(response.status);
    return (await response.json()) as JsonConversation;
  }

  async function send(
    cookies: string[],
    conversationId: string,
    payload: { body?: string; mediaIds?: string[] },
  ): Promise<{ status: number; message: JsonMessageBody }> {
    const response = await sendMessage(
      await mutate(
        cookies,
        `/api/conversations/${conversationId}/messages`,
        "POST",
        payload,
      ),
      routeContext(conversationId),
    );
    const body = (await response.json()) as { message?: JsonMessageBody };
    return { status: response.status, message: body.message as JsonMessageBody };
  }

  it("get-or-create is deterministic and unique per pair", async () => {
    const alice = await registerAccount();
    const bob = await registerAccount();

    const first = await openConversation(alice.cookies, bob.user.id);
    expect(first.created).toBe(true);
    const second = await openConversation(alice.cookies, bob.user.id);
    expect(second.conversation.id).toBe(first.conversation.id);
    expect(second.created).toBe(false);

    const reversed = await openConversation(bob.cookies, alice.user.id);
    expect(reversed.conversation.id).toBe(first.conversation.id);

    const stored = await prisma.conversation.count();
    expect(stored).toBeGreaterThanOrEqual(1);
    const participants = await prisma.conversationParticipant.count({
      where: { conversationId: first.conversation.id },
    });
    expect(participants).toBe(2);
  });

  it("resolves concurrent get-or-create requests to one conversation", async () => {
    const alice = await registerAccount();
    const bob = await registerAccount();
    const csrf = await issueCsrf(alice.cookies);
    const request = () =>
      startConversation(
        requestFor("/api/conversations", {
          method: "POST",
          cookies: alice.cookies,
          csrf: csrf.token,
          body: { userId: bob.user.id },
        }),
      );
    const responses = await Promise.all([request(), request(), request()]);
    const ids = await Promise.all(
      responses.map(async (response) =>
        ((await response.json()) as JsonConversation).conversation.id,
      ),
    );
    expect(new Set(ids).size).toBe(1);
  });

  it("rejects self conversations, anonymous access, and missing CSRF", async () => {
    const alice = await registerAccount();
    const self = await startConversation(
      await mutate(alice.cookies, "/api/conversations", "POST", {
        userId: alice.user.id,
      }),
    );
    expect(self.status).toBe(400);

    const anonymous = await listConversations(
      new Request(`${ORIGIN}/api/conversations`),
    );
    expect(anonymous.status).toBe(401);

    const noCsrf = await startConversation(
      requestFor("/api/conversations", {
        method: "POST",
        cookies: alice.cookies,
        body: { userId: alice.user.id },
      }),
    );
    expect(noCsrf.status).toBe(403);
  });

  it("supports cursor-paginated history in createdAt DESC, id DESC order", async () => {
    const alice = await registerAccount();
    const bob = await registerAccount();
    const { conversation } = await openConversation(alice.cookies, bob.user.id);

    for (let i = 0; i < 5; i += 1) {
      const sent = await send(alice.cookies, conversation.id, {
        body: `message ${i}`,
      });
      expect(sent.status).toBe(201);
    }

    const pageOne = await listMessages(
      requestFor(`/api/conversations/${conversation.id}/messages?limit=2`, {
        method: "GET",
        cookies: bob.cookies,
      }),
      routeContext(conversation.id),
    );
    const bodyOne = (await pageOne.json()) as {
      items: JsonMessageBody[];
      nextCursor: string | null;
    };
    expect(bodyOne.items.map((item) => item.body)).toEqual([
      "message 4",
      "message 3",
    ]);
    expect(bodyOne.nextCursor).toBeTruthy();

    const pageTwo = await listMessages(
      requestFor(
        `/api/conversations/${conversation.id}/messages?limit=10&cursor=${encodeURIComponent(
          bodyOne.nextCursor as string,
        )}`,
        { method: "GET", cookies: bob.cookies },
      ),
      routeContext(conversation.id),
    );
    const bodyTwo = (await pageTwo.json()) as { items: JsonMessageBody[] };
    expect(bodyTwo.items.map((item) => item.body)).toEqual([
      "message 2",
      "message 1",
      "message 0",
    ]);
  });

  it("tracks unread counts and clears them when marked read", async () => {
    const alice = await registerAccount();
    const bob = await registerAccount();
    const { conversation } = await openConversation(alice.cookies, bob.user.id);
    await send(alice.cookies, conversation.id, { body: "one" });
    await send(alice.cookies, conversation.id, { body: "two" });

    const bobView = await getConversation(
      requestFor(`/api/conversations/${conversation.id}`, {
        method: "GET",
        cookies: bob.cookies,
      }),
      routeContext(conversation.id),
    );
    const before = (await bobView.json()) as JsonConversation;
    expect(before.conversation.unreadCount).toBe(2);

    const read = await markRead(
      await mutate(
        bob.cookies,
        `/api/conversations/${conversation.id}/read`,
        "POST",
        {},
      ),
      routeContext(conversation.id),
    );
    expect(read.status).toBe(200);

    const after = await getConversation(
      requestFor(`/api/conversations/${conversation.id}`, {
        method: "GET",
        cookies: bob.cookies,
      }),
      routeContext(conversation.id),
    );
    expect(((await after.json()) as JsonConversation).conversation.unreadCount).toBe(
      0,
    );
  });

  it("allows only the sender to edit and delete, and soft-deletes bodies", async () => {
    const alice = await registerAccount();
    const bob = await registerAccount();
    const { conversation } = await openConversation(alice.cookies, bob.user.id);
    const sent = await send(alice.cookies, conversation.id, { body: "original" });
    const messageId = sent.message.id;

    const foreignEdit = await editMessage(
      await mutate(bob.cookies, `/api/messages/${messageId}`, "PATCH", {
        body: "hijacked",
      }),
      routeContext(messageId),
    );
    expect(foreignEdit.status).toBe(404);

    const edit = await editMessage(
      await mutate(alice.cookies, `/api/messages/${messageId}`, "PATCH", {
        body: "edited",
      }),
      routeContext(messageId),
    );
    const edited = (await edit.json()) as { message: JsonMessageBody };
    expect(edit.status).toBe(200);
    expect(edited.message.body).toBe("edited");
    expect(edited.message.edited).toBe(true);

    const foreignDelete = await deleteMessage(
      await mutate(bob.cookies, `/api/messages/${messageId}`, "DELETE"),
      routeContext(messageId),
    );
    expect(foreignDelete.status).toBe(404);

    const removed = await deleteMessage(
      await mutate(alice.cookies, `/api/messages/${messageId}`, "DELETE"),
      routeContext(messageId),
    );
    expect(removed.status).toBe(200);

    const history = await listMessages(
      requestFor(`/api/conversations/${conversation.id}/messages`, {
        method: "GET",
        cookies: bob.cookies,
      }),
      routeContext(conversation.id),
    );
    const body = (await history.json()) as { items: JsonMessageBody[] };
    const [latest] = body.items;
    expect(latest?.deleted).toBe(true);
    expect(latest?.body).toBeNull();

    const editDeleted = await editMessage(
      await mutate(alice.cookies, `/api/messages/${messageId}`, "PATCH", {
        body: "again",
      }),
      routeContext(messageId),
    );
    expect(editDeleted.status).toBe(404);
  });

  it("hides conversations from non-participants and after blocking", async () => {
    const alice = await registerAccount();
    const bob = await registerAccount();
    const carol = await registerAccount();
    const { conversation } = await openConversation(alice.cookies, bob.user.id);
    await send(alice.cookies, conversation.id, { body: "private" });

    const outsider = await getConversation(
      requestFor(`/api/conversations/${conversation.id}`, {
        method: "GET",
        cookies: carol.cookies,
      }),
      routeContext(conversation.id),
    );
    expect(outsider.status).toBe(404);

    await block(
      await mutate(alice.cookies, `/api/users/${bob.user.id}/block`, "POST"),
      routeContext(bob.user.id),
    );

    const blockedView = await getConversation(
      requestFor(`/api/conversations/${conversation.id}`, {
        method: "GET",
        cookies: alice.cookies,
      }),
      routeContext(conversation.id),
    );
    expect(blockedView.status).toBe(404);

    const blockedSend = await send(alice.cookies, conversation.id, {
      body: "still there?",
    });
    expect(blockedSend.status).toBe(404);

    const blockedCreate = await startConversation(
      await mutate(alice.cookies, "/api/conversations", "POST", {
        userId: bob.user.id,
      }),
    );
    expect(blockedCreate.status).toBe(404);

    const list = await listConversations(
      requestFor("/api/conversations", { method: "GET", cookies: alice.cookies }),
    );
    const listBody = (await list.json()) as { items: JsonConversation["conversation"][] };
    expect(listBody.items.some((item) => item.id === conversation.id)).toBe(false);
  });

  it("hides then restores a conversation for the participant who deleted it", async () => {
    const alice = await registerAccount();
    const bob = await registerAccount();
    const { conversation } = await openConversation(alice.cookies, bob.user.id);
    await send(alice.cookies, conversation.id, { body: "hello" });

    const hidden = await hideConversation(
      await mutate(alice.cookies, `/api/conversations/${conversation.id}`, "DELETE"),
      routeContext(conversation.id),
    );
    expect(hidden.status).toBe(200);

    const list = await listConversations(
      requestFor("/api/conversations", { method: "GET", cookies: alice.cookies }),
    );
    const listBody = (await list.json()) as { items: JsonConversation["conversation"][] };
    expect(listBody.items.some((item) => item.id === conversation.id)).toBe(false);

    await send(bob.cookies, conversation.id, { body: "ping" });
    const restored = await listConversations(
      requestFor("/api/conversations", { method: "GET", cookies: alice.cookies }),
    );
    const restoredBody = (await restored.json()) as {
      items: JsonConversation["conversation"][];
    };
    expect(restoredBody.items.some((item) => item.id === conversation.id)).toBe(true);
  });

  it("attaches owner media to a message and removes it on delete", async () => {
    const alice = await registerAccount();
    const bob = await registerAccount();
    const { conversation } = await openConversation(alice.cookies, bob.user.id);

    const start = await initiateMedia(
      await mutate(alice.cookies, "/api/media", "POST", {
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        byteSize: 12,
      }),
    );
    const started = (await start.json()) as { media: { id: string } };
    const complete = await completeMedia(
      await mutate(alice.cookies, `/api/media/${started.media.id}/complete`, "POST"),
      routeContext(started.media.id),
    );
    expect(complete.status).toBe(200);

    const sent = await send(alice.cookies, conversation.id, {
      mediaIds: [started.media.id],
    });
    expect(sent.status).toBe(201);
    expect(sent.message.media.map((item) => item.id)).toEqual([
      started.media.id,
    ]);

    const recipientAccess = await getMedia(
      requestFor(`/api/media/${started.media.id}`, {
        method: "GET",
        cookies: bob.cookies,
      }),
      routeContext(started.media.id),
    );
    expect(recipientAccess.status).toBe(200);

    const outsider = await registerAccount();
    const outsiderAccess = await getMedia(
      requestFor(`/api/media/${started.media.id}`, {
        method: "GET",
        cookies: outsider.cookies,
      }),
      routeContext(started.media.id),
    );
    expect(outsiderAccess.status).toBe(404);

    const removed = await deleteMessage(
      await mutate(alice.cookies, `/api/messages/${sent.message.id}`, "DELETE"),
      routeContext(sent.message.id),
    );
    expect(removed.status).toBe(200);
    const afterDelete = await getMedia(
      requestFor(`/api/media/${started.media.id}`, {
        method: "GET",
        cookies: bob.cookies,
      }),
      routeContext(started.media.id),
    );
    expect(afterDelete.status).toBe(404);
  });

  it("rejects empty bodies, oversized bodies, and non-owner media", async () => {
    const alice = await registerAccount();
    const bob = await registerAccount();
    const { conversation } = await openConversation(alice.cookies, bob.user.id);

    const empty = await send(alice.cookies, conversation.id, { body: "   " });
    expect(empty.status).toBe(400);

    const oversized = await send(alice.cookies, conversation.id, {
      body: "x".repeat(4001),
    });
    expect(oversized.status).toBe(400);

    const foreignStart = await initiateMedia(
      await mutate(bob.cookies, "/api/media", "POST", {
        filename: "bob.jpg",
        mimeType: "image/jpeg",
        byteSize: 12,
      }),
    );
    const foreign = (await foreignStart.json()) as { media: { id: string } };
    const stolen = await send(alice.cookies, conversation.id, {
      mediaIds: [foreign.media.id],
    });
    expect([400, 403]).toContain(stolen.status);
  });
});
