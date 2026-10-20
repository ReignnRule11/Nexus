import { describe, expect, it } from "vitest";
import {
  assertRequiredWhenUsed,
  getConfigStatus,
  loadEnv,
  loadAiConfig,
  loadStorageConfig,
  requireAiConfig,
  requireAuthSecret,
  requireStorageConfig,
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
    expect(env.userLlmProvider).toBeUndefined();
    expect(env.userLlmTimeoutMs).toBeUndefined();
    expect(env.userLlmMaxOutputTokens).toBeUndefined();
    expect(env.storageDriver).toBeUndefined();
    expect(env.s3AccessKeyId).toBeUndefined();
    expect(env.s3SecretAccessKey).toBeUndefined();
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

    expect(status.requiredWhenUsed).toEqual(
      expect.arrayContaining([
        { name: "DATABASE_URL", configured: true },
        { name: "AUTH_SECRET", configured: true },
        { name: "STORAGE_DRIVER", configured: false },
        { name: "S3_SECRET_ACCESS_KEY", configured: false },
      ]),
    );
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
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "USER_LLM_API_KEY",
    ]);
  });

  it("fails closed when AUTH_SECRET is absent", () => {
    expect(() => requireAuthSecret({})).toThrow(
      /Missing required configuration: AUTH_SECRET/,
    );
  });

  it("fails closed when private object storage is not configured", () => {
    expect(() => requireStorageConfig({})).toThrow(
      /Missing required configuration: STORAGE_DRIVER/,
    );
    expect(() =>
      loadStorageConfig({
        STORAGE_DRIVER: "filesystem",
      }),
    ).toThrow(/STORAGE_DRIVER/);
  });

  it("treats AI configuration as absent until a complete user-provided provider is set", () => {
    expect(loadAiConfig({})).toBeUndefined();
    expect(() => requireAiConfig({})).toThrow(
      /USER_LLM_API_KEY, USER_LLM_BASE_URL, USER_LLM_MODEL/,
    );
    expect(() =>
      loadAiConfig({ USER_LLM_API_KEY: "not-a-real-key" }),
    ).toThrow(/USER_LLM_API_KEY, USER_LLM_BASE_URL, USER_LLM_MODEL/);
  });

  it("loads a complete user-provided AI config without exposing the key in status", () => {
    const env = loadEnv({
      USER_LLM_API_KEY: "not-a-real-key",
      USER_LLM_BASE_URL: "https://llm.example.test/v1",
      USER_LLM_MODEL: "example-model",
    });
    const config = loadAiConfig({
      USER_LLM_API_KEY: "not-a-real-key",
      USER_LLM_BASE_URL: "https://llm.example.test/v1",
      USER_LLM_MODEL: "example-model",
    });
    const status = getConfigStatus(env);
    expect(config?.model).toBe("example-model");
    expect(config?.provider).toBe("openai-compatible");
    expect(JSON.stringify(status)).not.toContain("not-a-real-key");
  });
});
