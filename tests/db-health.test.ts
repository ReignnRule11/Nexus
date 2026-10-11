import { describe, expect, it } from "vitest";
import { GET as getApplicationHealthRoute } from "@/app/api/health/route";
import { GET as getDatabaseHealthRoute } from "@/app/api/health/db/route";
import { getDatabaseHealth } from "@/lib/db-health";
import { getApplicationHealth } from "@/lib/health";
import { requireDatabaseUrl } from "@/lib/env";

describe("database configuration and health", () => {
  it("fails closed when DATABASE_URL is absent", () => {
    expect(() => requireDatabaseUrl({})).toThrow(
      /Missing required configuration: DATABASE_URL/,
    );
  });

  it("reports not_configured without claiming PostgreSQL is healthy", async () => {
    const result = await getDatabaseHealth({ NODE_ENV: "test" }, async () => {
      throw new Error("ping should not run when DATABASE_URL is missing");
    });

    expect(result.httpStatus).toBe(503);
    expect(result.body).toEqual({
      status: "not_configured",
      service: "postgres",
    });
    expect(JSON.stringify(result.body)).not.toMatch(/postgres:\/\//);
  });

  it("reports unavailable without leaking connection errors", async () => {
    const result = await getDatabaseHealth(
      {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://example.invalid/nexus",
      },
      async () => {
        throw new Error("password=super-secret connection refused");
      },
    );

    expect(result.httpStatus).toBe(503);
    expect(result.body).toEqual({
      status: "unavailable",
      service: "postgres",
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(result)).not.toContain("connection refused");
  });

  it("reports ready only after a successful ping", async () => {
    const result = await getDatabaseHealth(
      {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://example.invalid/nexus",
      },
      async () => undefined,
    );

    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("ready");
  });

  it("keeps application health independent of database readiness", async () => {
    const appResponse = await getApplicationHealthRoute();
    const appBody = (await appResponse.json()) as ReturnType<
      typeof getApplicationHealth
    >;

    expect(appResponse.status).toBe(200);
    expect(appBody.status).toBe("ok");
    expect(appBody).not.toHaveProperty("database");

    const configured = Boolean(process.env.DATABASE_URL?.trim());
    if (configured) {
      return;
    }

    const dbResponse = await getDatabaseHealthRoute();
    const dbBody = (await dbResponse.json()) as {
      status: string;
      service: string;
    };

    expect(dbResponse.status).toBe(503);
    expect(dbBody.status).toBe("not_configured");
    expect(dbBody.service).toBe("postgres");
  });
});
