import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { getApplicationHealth } from "@/lib/health";

describe("application health", () => {
  it("reports process-level status without claiming unverified dependencies", () => {
    const health = getApplicationHealth();

    expect(health.status).toBe("ok");
    expect(health.service).toBe("nexus");
    expect(health.version).toBe("0.1.0");
    expect(health).not.toHaveProperty("database");
    expect(health).not.toHaveProperty("ai");
    expect(health).not.toHaveProperty("storage");
    expect(health).not.toHaveProperty("realtime");
  });

  it("responds to GET /api/health with HTTP 200", async () => {
    const response = await GET();
    const body = (await response.json()) as ReturnType<
      typeof getApplicationHealth
    >;

    expect(response.status).toBe(200);
    expect(body).toEqual(getApplicationHealth());
  });
});
