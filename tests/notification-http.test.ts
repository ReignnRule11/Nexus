import { describe, expect, it } from "vitest";
import { GET as listNotifications } from "@/app/api/notifications/route";
import { GET as getUnreadCount } from "@/app/api/notifications/unread-count/route";
import { POST as markRead } from "@/app/api/notifications/[id]/read/route";
import { POST as markAllRead } from "@/app/api/notifications/read-all/route";
import { toErrorBody } from "@/lib/http-error";
import { serializePublicNotification } from "@/lib/notifications";
import { NOTIFICATION_SEMANTICS } from "@/lib/notification-policy";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";

describe("notification routes without a database", () => {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());

  it.skipIf(databaseConfigured)(
    "fails closed instead of returning fake notifications",
    async () => {
      const response = await listNotifications(
        new Request("http://localhost/api/notifications"),
      );
      const body = (await response.json()) as { error: { code: string } };
      expect(response.status).toBe(503);
      expect(body.error.code).toBe("not_configured");
    },
  );

  it.skipIf(databaseConfigured)(
    "fails closed for unread count and read mutations",
    async () => {
      const unread = await getUnreadCount(
        new Request("http://localhost/api/notifications/unread-count"),
      );
      expect(unread.status).toBe(503);

      const one = await markRead(
        new Request(`http://localhost/api/notifications/${AGENT_ID}/read`, {
          method: "POST",
        }),
        { params: Promise.resolve({ id: AGENT_ID }) },
      );
      expect(one.status).toBe(503);

      const all = await markAllRead(
        new Request("http://localhost/api/notifications/read-all", {
          method: "POST",
        }),
      );
      expect(all.status).toBe(503);
    },
  );

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

  it("serializes only safe notification fields", () => {
    const serialized = serializePublicNotification({
      id: AGENT_ID,
      type: "COMMENT",
      createdAt: new Date("2026-10-16T12:00:00.000Z"),
      readAt: null,
      actor: {
        userId: AGENT_ID,
        username: "ada",
        displayName: "Ada",
        bio: null,
      },
      postId: AGENT_ID,
      commentId: AGENT_ID,
      conversationId: null,
      messageId: null,
      communityId: null,
    });
    expect(serialized.createdAt).toBe("2026-10-16T12:00:00.000Z");
    expect(serialized.readAt).toBeNull();
    expect(serialized.target.postId).toBe(AGENT_ID);
    const json = JSON.stringify(serialized);
    expect(json).not.toContain("password");
    expect(json).not.toContain("email");
    expect(json).not.toContain("token");
  });

  it("documents notification semantics", () => {
    expect(NOTIFICATION_SEMANTICS.scope).toContain("secondary");
    expect(NOTIFICATION_SEMANTICS.ownership).toContain("recipient");
  });

  it("exports notification handlers", () => {
    expect(typeof listNotifications).toBe("function");
    expect(typeof getUnreadCount).toBe("function");
    expect(typeof markRead).toBe("function");
    expect(typeof markAllRead).toBe("function");
  });
});
