import { describe, expect, it } from "vitest";
import { GET as listConversations, POST as startConversation } from "@/app/api/conversations/route";
import { GET as getConversation } from "@/app/api/conversations/[id]/route";
import { POST as sendMessage } from "@/app/api/conversations/[id]/messages/route";
import { PATCH as editMessage } from "@/app/api/messages/[id]/route";
import { MESSAGING_SEMANTICS, serializePublicMessage } from "@/lib/messaging";
import { toErrorBody } from "@/lib/http-error";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";

describe("messaging routes without a database", () => {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());

  it.skipIf(databaseConfigured)(
    "fails closed instead of returning fake conversations",
    async () => {
      const response = await listConversations(
        new Request("http://localhost/api/conversations"),
      );
      const body = (await response.json()) as { error: { code: string } };
      expect(response.status).toBe(503);
      expect(body.error.code).toBe("not_configured");
    },
  );

  it.skipIf(databaseConfigured)(
    "fails closed for conversation reads and message sends",
    async () => {
      const read = await getConversation(
        new Request(`http://localhost/api/conversations/${AGENT_ID}`),
        { params: Promise.resolve({ id: AGENT_ID }) },
      );
      expect(read.status).toBe(503);

      const sent = await sendMessage(
        new Request(`http://localhost/api/conversations/${AGENT_ID}/messages`, {
          method: "POST",
        }),
        { params: Promise.resolve({ id: AGENT_ID }) },
      );
      expect(sent.status).toBe(503);
    },
  );

  it("maps missing messaging configuration without leaking internals", () => {
    const mapped = toErrorBody(
      new Error(
        "Missing required configuration: DATABASE_URL. PostgreSQL access is unavailable until a connection string is provided. Do not use fake credentials.",
      ),
    );
    expect(mapped.status).toBe(503);
    expect(mapped.body.error.code).toBe("not_configured");
    expect(JSON.stringify(mapped.body)).not.toContain("postgresql://");
  });

  it("documents 1:1 messaging semantics", () => {
    expect(MESSAGING_SEMANTICS.participants).toContain("1:1");
    expect(MESSAGING_SEMANTICS.blocking).toContain("Blocking takes precedence");
    expect(MESSAGING_SEMANTICS.privacy).toContain("404");
  });

  it("serializes deleted messages without a body but keeps the timestamp", () => {
    const serialized = serializePublicMessage({
      id: AGENT_ID,
      conversationId: AGENT_ID,
      sender: {
        userId: AGENT_ID,
        username: "ada",
        displayName: "Ada",
        bio: null,
      },
      body: null,
      deleted: true,
      edited: false,
      createdAt: new Date("2026-10-14T12:00:00.000Z"),
      updatedAt: new Date("2026-10-14T12:00:00.000Z"),
      media: [],
    });
    expect(serialized.body).toBeNull();
    expect(serialized.deleted).toBe(true);
    expect(serialized.createdAt).toBe("2026-10-14T12:00:00.000Z");
    expect(JSON.stringify(serialized)).not.toContain("password");
  });

  it("exports messaging handlers", () => {
    expect(typeof listConversations).toBe("function");
    expect(typeof startConversation).toBe("function");
    expect(typeof getConversation).toBe("function");
    expect(typeof sendMessage).toBe("function");
    expect(typeof editMessage).toBe("function");
  });
});
