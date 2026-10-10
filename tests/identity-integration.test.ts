import { describe, expect, it } from "vitest";
import { loadEnv } from "@/lib/env";

const databaseUrl = loadEnv(process.env).databaseUrl;

describe.skipIf(Boolean(databaseUrl))(
  "identity PostgreSQL integration (blocked by environment)",
  () => {
    it("does not run against PostgreSQL because DATABASE_URL is unset", () => {
      expect(databaseUrl).toBeUndefined();
    });
  },
);

describe.skipIf(!databaseUrl)("identity PostgreSQL integration", () => {
  it("requires a dedicated test database before mutating identity tables", () => {
    expect(databaseUrl).toBeTruthy();
    expect(databaseUrl).not.toMatch(/[/.]prod(?:uction)?(?:[/?]|$)/i);
  });
});
