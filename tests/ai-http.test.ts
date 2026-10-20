import { describe, expect, it } from "vitest";
import { POST as runAgent } from "@/app/api/ai/agent/route";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { toErrorBody } from "@/lib/http-error";
import { AI_SEMANTICS } from "@/lib/ai/policy";
import { serializeAgentResponse } from "@/lib/ai/schemas";

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("AI agent routes without a database", () => {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());

  it.skipIf(databaseConfigured)(
    "fails closed instead of returning a fake agent answer",
    async () => {
      const previousSecret = process.env.AUTH_SECRET;
      process.env.AUTH_SECRET = "unit-test-auth-secret-not-for-production";
      try {
        const csrf = await getCsrf(new Request("http://localhost/api/auth/csrf"));
        const token = ((await csrf.json()) as { csrfToken: string }).csrfToken;
        const csrfCookie = csrf.headers.get("set-cookie") ?? "";
        const response = await runAgent(
          new Request("http://localhost/api/ai/agent", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "http://localhost",
              "x-csrf-token": token,
              cookie: `nexus_session=not-a-real-session; ${csrfCookie}`,
            },
            body: JSON.stringify({ message: "Find backend developers." }),
          }),
        );
        const body = (await response.json()) as { error: { code: string } };
        expect(response.status).toBe(503);
        expect(body.error.code).toBe("not_configured");
        expect(JSON.stringify(body)).not.toContain("postgresql://");
      } finally {
        if (previousSecret === undefined) {
          delete process.env.AUTH_SECRET;
        } else {
          process.env.AUTH_SECRET = previousSecret;
        }
      }
    },
  );

  it("rejects CSRF-less mutations", async () => {
    const previousSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "unit-test-auth-secret-not-for-production";
    try {
      const response = await runAgent(
        new Request("http://localhost/api/ai/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Find people." }),
        }),
      );
      const body = (await response.json()) as { error: { code: string } };
      expect(response.status).toBe(403);
      expect(body.error.code).toBe("csrf");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.AUTH_SECRET;
      } else {
        process.env.AUTH_SECRET = previousSecret;
      }
    }
  });

  it("maps missing AI configuration without leaking internals", () => {
    const mapped = toErrorBody(
      new Error(
        "Missing required configuration: USER_LLM_API_KEY, USER_LLM_BASE_URL, USER_LLM_MODEL. AI is unavailable until a user-provided provider is configured. Do not use fake credentials.",
      ),
    );
    expect(mapped.status).toBe(503);
    expect(mapped.body.error.code).toBe("not_configured");
    expect(JSON.stringify(mapped.body)).not.toContain("USER_LLM_API_KEY");
  });

  it("serializes only confirmation-required public fields", () => {
    const serialized = serializeAgentResponse({
      message: "Draft a follow.",
      sources: [{ type: "user", id: USER_ID, name: "Ada" }],
      suggestions: [{ type: "user", id: USER_ID, reason: "Relevant" }],
      actions: [
        { type: "FOLLOW_USER", targetId: USER_ID, requiresConfirmation: true },
      ],
    });
    expect(serialized.actions[0]).toEqual({
      type: "FOLLOW_USER",
      targetId: USER_ID,
      requiresConfirmation: true,
    });
  });

  it("documents agent semantics and exports the handler", () => {
    expect(AI_SEMANTICS.role).toContain("never executes");
    expect(typeof runAgent).toBe("function");
  });
});
