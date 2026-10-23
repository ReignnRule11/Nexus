import { describe, expect, it } from "vitest";
import { POST as follow } from "@/app/api/users/[id]/follow/route";
import { POST as block } from "@/app/api/users/[id]/block/route";
import { GET as search } from "@/app/api/users/search/route";
import { GET as publicProfile } from "@/app/api/users/[id]/route";
import { toErrorBody } from "@/lib/http-error";

describe("graph routes without PostgreSQL", () => {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());

  it.skipIf(databaseConfigured)(
    "fails closed instead of using an in-memory graph",
    async () => {
      const previousSecret = process.env.AUTH_SECRET;
      process.env.AUTH_SECRET = "unit-test-auth-secret-not-for-production";
      try {
        const response = await search(
          new Request("http://localhost/api/users/search?q=ada"),
        );
        const body = (await response.json()) as {
          error: { code: string };
        };
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
    expect(mapped.body.error.code).toBe("not_configured");
    expect(JSON.stringify(mapped.body)).not.toContain("postgresql://");
  });

  it("exports graph mutation handlers", () => {
    expect(typeof follow).toBe("function");
    expect(typeof block).toBe("function");
    expect(typeof search).toBe("function");
    expect(typeof publicProfile).toBe("function");
  });
});
