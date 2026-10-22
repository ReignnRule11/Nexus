import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { POST as register } from "@/app/api/auth/register/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as createPost } from "@/app/api/posts/route";
import { GET as getPost } from "@/app/api/posts/[id]/route";
import { DELETE as deletePost } from "@/app/api/posts/[id]/route";
import { POST as createComment } from "@/app/api/posts/[id]/comments/route";
import { POST as startConversation } from "@/app/api/conversations/route";
import { POST as sendMessage } from "@/app/api/conversations/[id]/messages/route";
import { POST as createCommunity } from "@/app/api/communities/route";
import { GET as getCommunity } from "@/app/api/communities/[id]/route";
import { POST as createReport } from "@/app/api/reports/route";
import { GET as listMine } from "@/app/api/reports/mine/route";
import { GET as getMine } from "@/app/api/reports/[id]/route";
import { GET as listQueue } from "@/app/api/moderation/reports/route";
import { GET as getQueueReport } from "@/app/api/moderation/reports/[id]/route";
import { POST as claimReport } from "@/app/api/moderation/reports/[id]/claim/route";
import { POST as assignReport } from "@/app/api/moderation/reports/[id]/assign/route";
import { POST as resolveReport } from "@/app/api/moderation/reports/[id]/resolve/route";
import { POST as dismissReport } from "@/app/api/moderation/reports/[id]/dismiss/route";
import { POST as viewMessage } from "@/app/api/moderation/reports/[id]/message/route";
import { POST as enforce } from "@/app/api/moderation/actions/route";
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
const MISSING_ID = "99999999-9999-4999-8999-999999999999";

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
type JsonMessage = { message: { id: string; body: string | null } };
type JsonCommunity = { community: { id: string; visibility: string } };
type JsonReport = {
  report: {
    id: string;
    targetType: string;
    targetId: string;
    reason: string;
    explanation: string | null;
    status: string;
    assignedModeratorId?: string | null;
    resolutionNote?: string | null;
    target: Record<string, unknown> | null;
    reporter?: { userId: string } | null;
    actions?: Array<{ actionType: string; outcome: string; reason: string }>;
  };
};
type JsonAction = {
  action: { id: string; actionType: string; outcome: string };
};
type JsonPage<T> = { items: T[]; nextCursor: string | null };

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
  "moderation PostgreSQL integration (blocked by environment)",
  () => {
    it("does not mutate PostgreSQL unless DATABASE_URL points at nexus_test", () => {
      expect(connectedDatabaseName === TEST_DATABASE_NAME).toBe(false);
    });
  },
);

describe.skipIf(!canRunIntegration)("moderation PostgreSQL integration", () => {
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
    await prisma.moderationAction.deleteMany({
      where: { OR: [{ moderatorId: { in: ids } }] },
    });
    await prisma.report.deleteMany({
      where: { reporterId: { in: ids } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  async function registerAccount(prefix = "mod") {
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
          displayName: "Moderation User",
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

  async function grantModerator(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { isModerator: true },
    });
  }

  it("rejects anonymous and invalid report creation", async () => {
    const alice = await registerAccount("alice");
    const bob = await registerAccount("bob");
    const anon = await createReport(
      requestFor("/api/reports", {
        method: "POST",
        body: { targetType: "USER", targetId: bob.user.id, reason: "SPAM" },
      }),
    );
    expect(anon.status).toBe(403);

    const invalidReason = await createReport(
      await mutate(alice.cookies, "/api/reports", "POST", {
        targetType: "USER",
        targetId: bob.user.id,
        reason: "OFF_TOPIC",
      }),
    );
    expect(invalidReason.status).toBe(400);

    const oversized = await createReport(
      await mutate(alice.cookies, "/api/reports", "POST", {
        targetType: "USER",
        targetId: bob.user.id,
        reason: "SPAM",
        explanation: "x".repeat(501),
      }),
    );
    expect(oversized.status).toBe(400);

    const missing = await createReport(
      await mutate(alice.cookies, "/api/reports", "POST", {
        targetType: "USER",
        targetId: MISSING_ID,
        reason: "SPAM",
      }),
    );
    expect(missing.status).toBe(404);

    const selfReport = await createReport(
      await mutate(alice.cookies, "/api/reports", "POST", {
        targetType: "USER",
        targetId: alice.user.id,
        reason: "SPAM",
      }),
    );
    expect(selfReport.status).toBe(400);
  });

  it("creates a report, rejects duplicates, and keeps reporter privacy", async () => {
    const alice = await registerAccount("rep");
    const bob = await registerAccount("tgt");
    const created = await createReport(
      await mutate(alice.cookies, "/api/reports", "POST", {
        targetType: "USER",
        targetId: bob.user.id,
        reason: "HARASSMENT",
        explanation: "unwanted contact",
        reporterId: bob.user.id,
        status: "RESOLVED",
        isModerator: true,
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as JsonReport;
    expect(createdBody.report.status).toBe("OPEN");
    expect(createdBody.report.targetType).toBe("USER");
    expect(JSON.stringify(createdBody)).not.toContain("assignedModeratorId");
    expect(JSON.stringify(createdBody)).not.toContain("resolutionNote");

    const duplicate = await createReport(
      await mutate(alice.cookies, "/api/reports", "POST", {
        targetType: "USER",
        targetId: bob.user.id,
        reason: "SPAM",
      }),
    );
    expect(duplicate.status).toBe(409);

    const mine = await listMine(
      requestFor("/api/reports/mine", { method: "GET", cookies: alice.cookies }),
    );
    const mineBody = (await mine.json()) as JsonPage<JsonReport["report"]>;
    expect(mine.status).toBe(200);
    expect(mineBody.items).toHaveLength(1);

    const other = await getMine(
      requestFor(`/api/reports/${createdBody.report.id}`, {
        method: "GET",
        cookies: bob.cookies,
      }),
      routeContext(createdBody.report.id),
    );
    expect(other.status).toBe(404);

    const queue = await listQueue(
      requestFor("/api/moderation/reports", {
        method: "GET",
        cookies: alice.cookies,
      }),
    );
    expect(queue.status).toBe(403);
  });

  it("hides private communities and non-participant messages from reporters", async () => {
    const owner = await registerAccount("own");
    const member = await registerAccount("mem");
    const stranger = await registerAccount("str");
    const communityRes = await createCommunity(
      await mutate(owner.cookies, "/api/communities", "POST", {
        name: "Private Builders",
        visibility: "PRIVATE",
      }),
    );
    const community = (await communityRes.json()) as JsonCommunity;
    const strangerCommunity = await createReport(
      await mutate(stranger.cookies, "/api/reports", "POST", {
        targetType: "COMMUNITY",
        targetId: community.community.id,
        reason: "SPAM",
      }),
    );
    expect(strangerCommunity.status).toBe(404);
    const leaked = await getCommunity(
      requestFor(`/api/communities/${community.community.id}`, {
        method: "GET",
        cookies: stranger.cookies,
      }),
      routeContext(community.community.id),
    );
    expect(leaked.status).toBe(404);

    const convoRes = await startConversation(
      await mutate(owner.cookies, "/api/conversations", "POST", {
        userId: member.user.id,
      }),
    );
    const convo = (await convoRes.json()) as JsonConversation;
    const messageRes = await sendMessage(
      await mutate(owner.cookies, `/api/conversations/${convo.conversation.id}/messages`, "POST", {
        body: "secret private message body",
      }),
      routeContext(convo.conversation.id),
    );
    const message = (await messageRes.json()) as JsonMessage;
    const strangerMessage = await createReport(
      await mutate(stranger.cookies, "/api/reports", "POST", {
        targetType: "MESSAGE",
        targetId: message.message.id,
        reason: "HARASSMENT",
      }),
    );
    expect(strangerMessage.status).toBe(404);

    const participantReport = await createReport(
      await mutate(member.cookies, "/api/reports", "POST", {
        targetType: "MESSAGE",
        targetId: message.message.id,
        reason: "HARASSMENT",
      }),
    );
    expect(participantReport.status).toBe(201);
    const reported = (await participantReport.json()) as JsonReport;
    expect(JSON.stringify(reported)).not.toContain("secret private message body");
  });

  it("runs moderator workflow, audit, hide/restore, warn, and suspend rules", async () => {
    const reporter = await registerAccount("rpt");
    const author = await registerAccount("aut");
    const staff = await registerAccount("stf");
    const otherStaff = await registerAccount("st2");
    await grantModerator(staff.user.id);
    await grantModerator(otherStaff.user.id);

    const postRes = await createPost(
      await mutate(author.cookies, "/api/posts", "POST", {
        body: "please hide this post",
      }),
    );
    const post = (await postRes.json()) as JsonPost;
    const commentRes = await createComment(
      await mutate(author.cookies, `/api/posts/${post.post.id}/comments`, "POST", {
        body: "please hide this comment",
      }),
      routeContext(post.post.id),
    );
    const comment = (await commentRes.json()) as JsonComment;

    const reportRes = await createReport(
      await mutate(reporter.cookies, "/api/reports", "POST", {
        targetType: "POST",
        targetId: post.post.id,
        reason: "SPAM",
      }),
    );
    const report = (await reportRes.json()) as JsonReport;

    const anonQueue = await listQueue(
      requestFor("/api/moderation/reports", { method: "GET" }),
    );
    expect(anonQueue.status).toBe(401);

    const queue = await listQueue(
      requestFor("/api/moderation/reports", {
        method: "GET",
        cookies: staff.cookies,
      }),
    );
    expect(queue.status).toBe(200);
    const queueBody = (await queue.json()) as JsonPage<JsonReport["report"]>;
    expect(JSON.stringify(queueBody)).not.toContain("please hide this post");

    const resolveOpen = await resolveReport(
      await mutate(staff.cookies, `/api/moderation/reports/${report.report.id}/resolve`, "POST", {
        reason: "too soon",
      }),
      routeContext(report.report.id),
    );
    expect(resolveOpen.status).toBe(409);

    const claimed = await claimReport(
      await mutate(staff.cookies, `/api/moderation/reports/${report.report.id}/claim`, "POST"),
      routeContext(report.report.id),
    );
    expect(claimed.status).toBe(200);
    const claimedAgain = await claimReport(
      await mutate(otherStaff.cookies, `/api/moderation/reports/${report.report.id}/claim`, "POST"),
      routeContext(report.report.id),
    );
    expect(claimedAgain.status).toBe(409);

    const assigned = await assignReport(
      await mutate(staff.cookies, `/api/moderation/reports/${report.report.id}/assign`, "POST", {
        moderatorId: otherStaff.user.id,
      }),
      routeContext(report.report.id),
    );
    expect(assigned.status).toBe(200);

    const dismissEmpty = await dismissReport(
      await mutate(otherStaff.cookies, `/api/moderation/reports/${report.report.id}/dismiss`, "POST", {
        reason: "   ",
      }),
      routeContext(report.report.id),
    );
    expect(dismissEmpty.status).toBe(400);

    const hide = await enforce(
      await mutate(staff.cookies, "/api/moderation/actions", "POST", {
        actionType: "HIDE_CONTENT",
        targetType: "POST",
        targetId: post.post.id,
        reason: "spam post",
        reportId: report.report.id,
      }),
    );
    expect(hide.status).toBe(200);
    const hiddenPost = await getPost(
      requestFor(`/api/posts/${post.post.id}`, {
        method: "GET",
        cookies: reporter.cookies,
      }),
      routeContext(post.post.id),
    );
    expect(hiddenPost.status).toBe(404);
    const hideAgain = await enforce(
      await mutate(staff.cookies, "/api/moderation/actions", "POST", {
        actionType: "HIDE_CONTENT",
        targetType: "POST",
        targetId: post.post.id,
        reason: "spam post again",
      }),
    );
    expect(hideAgain.status).toBe(200);

    await deletePost(
      await mutate(author.cookies, `/api/posts/${post.post.id}`, "DELETE"),
      routeContext(post.post.id),
    );
    const restore = await enforce(
      await mutate(staff.cookies, "/api/moderation/actions", "POST", {
        actionType: "RESTORE_CONTENT",
        targetType: "POST",
        targetId: post.post.id,
        reason: "restore after owner delete",
      }),
    );
    const restoreBody = (await restore.json()) as JsonAction;
    expect(restore.status).toBe(200);
    expect(restoreBody.action.outcome).toBe("owner_deleted");
    const stillGone = await getPost(
      requestFor(`/api/posts/${post.post.id}`, {
        method: "GET",
        cookies: reporter.cookies,
      }),
      routeContext(post.post.id),
    );
    expect(stillGone.status).toBe(404);

    const hideComment = await enforce(
      await mutate(staff.cookies, "/api/moderation/actions", "POST", {
        actionType: "HIDE_CONTENT",
        targetType: "COMMENT",
        targetId: comment.comment.id,
        reason: "hide comment",
      }),
    );
    expect(hideComment.status).toBe(200);

    const warn = await enforce(
      await mutate(staff.cookies, "/api/moderation/actions", "POST", {
        actionType: "WARN_USER",
        targetType: "USER",
        targetId: author.user.id,
        reason: "first warning",
      }),
    );
    expect(warn.status).toBe(200);

    const selfSuspend = await enforce(
      await mutate(staff.cookies, "/api/moderation/actions", "POST", {
        actionType: "SUSPEND_USER",
        targetType: "USER",
        targetId: staff.user.id,
        reason: "should fail",
      }),
    );
    expect(selfSuspend.status).toBe(400);

    const suspend = await enforce(
      await mutate(staff.cookies, "/api/moderation/actions", "POST", {
        actionType: "SUSPEND_USER",
        targetType: "USER",
        targetId: author.user.id,
        reason: "repeat spam",
      }),
    );
    expect(suspend.status).toBe(200);
    const suspendedMe = await me(
      requestFor("/api/auth/me", { method: "GET", cookies: author.cookies }),
    );
    expect(suspendedMe.status).toBe(401);
    const suspendedMutate = await createPost(
      await mutate(author.cookies, "/api/posts", "POST", { body: "still trying" }),
    );
    expect([401, 403]).toContain(suspendedMutate.status);

    const unsuspend = await enforce(
      await mutate(staff.cookies, "/api/moderation/actions", "POST", {
        actionType: "UNSUSPEND_USER",
        targetType: "USER",
        targetId: author.user.id,
        reason: "appeal accepted",
      }),
    );
    expect(unsuspend.status).toBe(200);

    await prisma.user.update({
      where: { id: author.user.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    const unsuspendDeleted = await enforce(
      await mutate(staff.cookies, "/api/moderation/actions", "POST", {
        actionType: "UNSUSPEND_USER",
        targetType: "USER",
        targetId: author.user.id,
        reason: "should not revive",
      }),
    );
    expect(unsuspendDeleted.status).toBe(404);

    const resolved = await resolveReport(
      await mutate(otherStaff.cookies, `/api/moderation/reports/${report.report.id}/resolve`, "POST", {
        reason: "hidden and warned",
      }),
      routeContext(report.report.id),
    );
    expect(resolved.status).toBe(200);
    const resolvedBody = (await resolved.json()) as JsonReport;
    expect(resolvedBody.report.status).toBe("RESOLVED");
    expect(resolvedBody.report.actions?.some((row) => row.actionType === "RESOLVE_REPORT")).toBe(true);

    const reopen = await claimReport(
      await mutate(staff.cookies, `/api/moderation/reports/${report.report.id}/claim`, "POST"),
      routeContext(report.report.id),
    );
    expect(reopen.status).toBe(409);

    const reporterView = await getMine(
      requestFor(`/api/reports/${report.report.id}`, {
        method: "GET",
        cookies: reporter.cookies,
      }),
      routeContext(report.report.id),
    );
    const reporterViewBody = (await reporterView.json()) as JsonReport;
    expect(reporterView.status).toBe(200);
    expect(reporterViewBody.report.status).toBe("RESOLVED");
    expect(JSON.stringify(reporterViewBody)).not.toContain("hidden and warned");
    expect(JSON.stringify(reporterViewBody)).not.toContain("assignedModeratorId");
  });

  it("audits private message review and does not leak secrets", async () => {
    const sender = await registerAccount("snd");
    const recipient = await registerAccount("rcv");
    const staff = await registerAccount("mod");
    await grantModerator(staff.user.id);
    const convoRes = await startConversation(
      await mutate(sender.cookies, "/api/conversations", "POST", {
        userId: recipient.user.id,
      }),
    );
    const convo = (await convoRes.json()) as JsonConversation;
    const messageRes = await sendMessage(
      await mutate(sender.cookies, `/api/conversations/${convo.conversation.id}/messages`, "POST", {
        body: "do not leak this private body",
      }),
      routeContext(convo.conversation.id),
    );
    const message = (await messageRes.json()) as JsonMessage;
    const reportRes = await createReport(
      await mutate(recipient.cookies, "/api/reports", "POST", {
        targetType: "MESSAGE",
        targetId: message.message.id,
        reason: "HARASSMENT",
      }),
    );
    const report = (await reportRes.json()) as JsonReport;
    const queued = await getQueueReport(
      requestFor(`/api/moderation/reports/${report.report.id}`, {
        method: "GET",
        cookies: staff.cookies,
      }),
      routeContext(report.report.id),
    );
    const queuedBody = (await queued.json()) as JsonReport;
    expect(JSON.stringify(queuedBody)).not.toContain("do not leak this private body");

    const viewed = await viewMessage(
      await mutate(staff.cookies, `/api/moderation/reports/${report.report.id}/message`, "POST"),
      routeContext(report.report.id),
    );
    expect(viewed.status).toBe(200);
    const viewedBody = (await viewed.json()) as JsonMessage;
    expect(viewedBody.message.body).toBe("do not leak this private body");

    const detail = await getQueueReport(
      requestFor(`/api/moderation/reports/${report.report.id}`, {
        method: "GET",
        cookies: staff.cookies,
      }),
      routeContext(report.report.id),
    );
    const detailBody = (await detail.json()) as JsonReport;
    expect(detailBody.report.actions?.some((row) => row.actionType === "VIEW_PRIVATE_MESSAGE")).toBe(true);
    expect(JSON.stringify(detailBody.report.actions)).not.toContain("do not leak this private body");
  });
});
