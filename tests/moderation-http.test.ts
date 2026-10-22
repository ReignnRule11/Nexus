import { describe, expect, it } from "vitest";
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
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { toErrorBody } from "@/lib/http-error";
import { serializePublicReporterReport } from "@/lib/moderation";
import { MODERATION_SEMANTICS } from "@/lib/moderation-policy";

const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

describe("moderation routes without a database", () => {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());

  it.skipIf(databaseConfigured)(
    "fails closed instead of returning fake reports",
    async () => {
      const response = await listMine(
        new Request("http://localhost/api/reports/mine"),
      );
      const body = (await response.json()) as { error: { code: string } };
      expect(response.status).toBe(503);
      expect(body.error.code).toBe("not_configured");
    },
  );

  it.skipIf(databaseConfigured)(
    "fails closed for moderator queue and mutations",
    async () => {
      const queue = await listQueue(
        new Request("http://localhost/api/moderation/reports"),
      );
      expect(queue.status).toBe(503);

      const previousSecret = process.env.AUTH_SECRET;
      process.env.AUTH_SECRET = "unit-test-auth-secret-not-for-production";
      try {
        const csrf = await getCsrf(new Request("http://localhost/api/auth/csrf"));
        const token = ((await csrf.json()) as { csrfToken: string }).csrfToken;
        const csrfCookie = csrf.headers.get("set-cookie") ?? "";
        const created = await createReport(
          new Request("http://localhost/api/reports", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "http://localhost",
              "x-csrf-token": token,
              cookie: csrfCookie,
            },
            body: JSON.stringify({
              targetType: "USER",
              targetId: TARGET_ID,
              reason: "SPAM",
            }),
          }),
        );
        expect(created.status).toBe(503);
      } finally {
        if (previousSecret === undefined) {
          delete process.env.AUTH_SECRET;
        } else {
          process.env.AUTH_SECRET = previousSecret;
        }
      }
    },
  );

  it("rejects CSRF-less report and enforcement mutations", async () => {
    const previousSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "unit-test-auth-secret-not-for-production";
    try {
      const created = await createReport(
        new Request("http://localhost/api/reports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            targetType: "USER",
            targetId: TARGET_ID,
            reason: "SPAM",
          }),
        }),
      );
      expect(created.status).toBe(403);
      const createdBody = (await created.json()) as { error: { code: string } };
      expect(createdBody.error.code).toBe("csrf");

      const action = await enforce(
        new Request("http://localhost/api/moderation/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actionType: "WARN_USER",
            targetType: "USER",
            targetId: TARGET_ID,
            reason: "warning",
          }),
        }),
      );
      expect(action.status).toBe(403);
    } finally {
      if (previousSecret === undefined) {
        delete process.env.AUTH_SECRET;
      } else {
        process.env.AUTH_SECRET = previousSecret;
      }
    }
  });

  it("maps missing configuration without leaking internals", () => {
    const mapped = toErrorBody(
      new Error(
        "Missing required configuration: DATABASE_URL. PostgreSQL access is unavailable until a connection string is provided. Do not use fake credentials.",
      ),
    );
    expect(mapped.status).toBe(503);
    expect(mapped.body.error.code).toBe("not_configured");
    expect(JSON.stringify(mapped.body)).not.toContain("postgresql://");
  });

  it("serializes only safe reporter fields", () => {
    const serialized = serializePublicReporterReport({
      id: REPORT_ID,
      targetType: "MESSAGE",
      targetId: TARGET_ID,
      target: {
        type: "MESSAGE",
        id: TARGET_ID,
        visible: true,
        conversationId: REPORT_ID,
      },
      reason: "HARASSMENT",
      explanation: "unwanted contact",
      status: "OPEN",
      createdAt: new Date("2026-10-20T12:00:00.000Z"),
      updatedAt: new Date("2026-10-20T12:00:00.000Z"),
      resolvedAt: null,
    });
    expect(serialized.createdAt).toBe("2026-10-20T12:00:00.000Z");
    const json = JSON.stringify(serialized);
    expect(json).not.toContain("password");
    expect(json).not.toContain("email");
    expect(json).not.toContain("token");
    expect(json).not.toContain("assignedModerator");
    expect(json).not.toContain("resolutionNote");
  });

  it("documents moderation semantics and exports handlers", () => {
    expect(MODERATION_SEMANTICS.role).toContain("never self-granted");
    expect(typeof createReport).toBe("function");
    expect(typeof listMine).toBe("function");
    expect(typeof getMine).toBe("function");
    expect(typeof listQueue).toBe("function");
    expect(typeof getQueueReport).toBe("function");
    expect(typeof claimReport).toBe("function");
    expect(typeof assignReport).toBe("function");
    expect(typeof resolveReport).toBe("function");
    expect(typeof dismissReport).toBe("function");
    expect(typeof viewMessage).toBe("function");
    expect(typeof enforce).toBe("function");
  });
});
