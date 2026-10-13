import { describe, expect, it } from "vitest";
import { POST as initiate } from "@/app/api/media/route";
import { GET as getMedia } from "@/app/api/media/[id]/route";
import { toErrorBody } from "@/lib/http-error";

describe("media routes without storage", () => {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());

  it.skipIf(databaseConfigured)(
    "fails closed instead of using in-memory storage",
    async () => {
      const previousSecret = process.env.AUTH_SECRET;
      process.env.AUTH_SECRET = "unit-test-auth-secret-not-for-production";
      try {
        const response = await getMedia(
          new Request(
            "http://localhost/api/media/11111111-1111-4111-8111-111111111111",
          ),
          {
            params: Promise.resolve({
              id: "11111111-1111-4111-8111-111111111111",
            }),
          },
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

  it("maps missing storage configuration without leaking internals", () => {
    const mapped = toErrorBody(
      new Error(
        "Missing required configuration: STORAGE_DRIVER. Object storage is unavailable until a private S3-compatible bucket is provided. Do not use fake credentials.",
      ),
    );
    expect(mapped.status).toBe(503);
    expect(mapped.body.error.code).toBe("not_configured");
    expect(JSON.stringify(mapped.body)).not.toContain("S3_SECRET");
  });

  it("exports media handlers", () => {
    expect(typeof initiate).toBe("function");
    expect(typeof getMedia).toBe("function");
  });
});
