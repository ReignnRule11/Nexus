import { describe, expect, it } from "vitest";
import { POST as createPost } from "@/app/api/posts/route";
import { GET as getFeed } from "@/app/api/feed/route";
import { toErrorBody } from "@/lib/http-error";

describe("post routes without PostgreSQL", () => {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());

  it.skipIf(databaseConfigured)(
    "fails closed instead of using an in-memory feed",
    async () => {
      const previousSecret = process.env.AUTH_SECRET;
      process.env.AUTH_SECRET = "unit-test-auth-secret-not-for-production";
      try {
        const response = await getFeed(
          new Request("http://localhost/api/feed"),
        );
        const body = (await response.json()) as { error: { code: string } };
        expect(response.status).toBe(503);
        expect(body.error.code).toBe("not_configured");
      } finally {
        if (previousSecret === undefined) {
          delete process.env.AUTH_SECRET;
        } else {
          process.env.AUTH_SECRET = previousSecret;
        }
      }
    },
  );

  it("maps missing database configuration without leaking internals", () => {
    const mapped = toErrorBody(
      new Error(
        "Missing required configuration: DATABASE_URL. PostgreSQL access is unavailable until a connection string is provided. Do not use fake credentials.",
      ),
    );
    expect(mapped.status).toBe(503);
    expect(JSON.stringify(mapped.body)).not.toContain("postgresql://");
  });

  it("exports content handlers", () => {
    expect(typeof createPost).toBe("function");
    expect(typeof getFeed).toBe("function");
  });
});
