import { describe, expect, it } from "vitest";
import {
  assertRequiredWhenUsed,
  getConfigStatus,
  loadEnv,
  requireAuthSecret,
  serverSecretNames,
} from "@/lib/env";

describe("environment configuration", () => {
  it("loads without crashing when optional integrations are unset", () => {
    const env = loadEnv({ NODE_ENV: "development" });

    expect(env.nodeEnv).toBe("development");
    expect(env.databaseUrl).toBeUndefined();
    expect(env.authSecret).toBeUndefined();
    expect(env.userLlmApiKey).toBeUndefined();
    expect(env.userLlmBaseUrl).toBeUndefined();
    expect(env.userLlmModel).toBeUndefined();
  });

  it("does not substitute fake credentials for empty values", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: "   ",
      AUTH_SECRET: "",
      USER_LLM_API_KEY: "",
    });

    expect(env.databaseUrl).toBeUndefined();
    expect(env.authSecret).toBeUndefined();
    expect(env.userLlmApiKey).toBeUndefined();
  });

  it("reports configuration presence without exposing secret values", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://example.invalid/nexus",
      AUTH_SECRET: "not-a-real-secret",
    });
    const status = getConfigStatus(env);
    const serialized = JSON.stringify(status);

    expect(status.requiredWhenUsed).toEqual([
      { name: "DATABASE_URL", configured: true },
      { name: "AUTH_SECRET", configured: true },
    ]);
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("not-a-real-secret");
  });

  it("throws when a later phase requires an unset value", () => {
    const env = loadEnv({ NODE_ENV: "test" });

    expect(() => assertRequiredWhenUsed(["DATABASE_URL"], env)).toThrow(
      /Missing required configuration: DATABASE_URL/,
    );
  });

  it("keeps secret names server-side only", () => {
    expect(serverSecretNames).toEqual([
      "DATABASE_URL",
      "AUTH_SECRET",
      "USER_LLM_API_KEY",
    ]);
  });

  it("fails closed when AUTH_SECRET is absent", () => {
    expect(() => requireAuthSecret({})).toThrow(
      /Missing required configuration: AUTH_SECRET/,
    );
  });
});
