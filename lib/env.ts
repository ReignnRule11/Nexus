import "server-only";

export type NodeEnv = "development" | "test" | "production";

export type Env = {
  nodeEnv: NodeEnv;
  databaseUrl: string | undefined;
  authSecret: string | undefined;
  userLlmApiKey: string | undefined;
  userLlmBaseUrl: string | undefined;
  userLlmModel: string | undefined;
};

export type ConfigItem = {
  name: string;
  configured: boolean;
};

export type ConfigStatus = {
  requiredWhenUsed: ConfigItem[];
  optional: ConfigItem[];
};

const SECRET_NAMES = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "USER_LLM_API_KEY",
] as const;

function resolveNodeEnvFrom(source: EnvSource): NodeEnv {
  const value = source.NODE_ENV;
  if (value === "production" || value === "test" || value === "development") {
    return value;
  }
  return "development";
}

export type EnvSource = Record<string, string | undefined>;

function readFrom(source: EnvSource, name: string): string | undefined {
  const value = source[name];
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return value;
}

export function loadEnv(source: EnvSource = process.env): Env {
  return {
    nodeEnv: resolveNodeEnvFrom(source),
    databaseUrl: readFrom(source, "DATABASE_URL"),
    authSecret: readFrom(source, "AUTH_SECRET"),
    userLlmApiKey: readFrom(source, "USER_LLM_API_KEY"),
    userLlmBaseUrl: readFrom(source, "USER_LLM_BASE_URL"),
    userLlmModel: readFrom(source, "USER_LLM_MODEL"),
  };
}

export function getConfigStatus(env: Env = loadEnv()): ConfigStatus {
  return {
    requiredWhenUsed: [
      { name: "DATABASE_URL", configured: Boolean(env.databaseUrl) },
      { name: "AUTH_SECRET", configured: Boolean(env.authSecret) },
    ],
    optional: [
      { name: "USER_LLM_API_KEY", configured: Boolean(env.userLlmApiKey) },
      { name: "USER_LLM_BASE_URL", configured: Boolean(env.userLlmBaseUrl) },
      { name: "USER_LLM_MODEL", configured: Boolean(env.userLlmModel) },
    ],
  };
}

export function assertRequiredWhenUsed(
  names: readonly string[],
  env: Env = loadEnv(),
): void {
  const status = getConfigStatus(env);
  const missing = names.filter((name) => {
    const item = [...status.requiredWhenUsed, ...status.optional].find(
      (entry) => entry.name === name,
    );
    return !item?.configured;
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration: ${missing.join(", ")}. Set values in the environment. Do not use fake credentials.`,
    );
  }
}

export function requireDatabaseUrl(source: EnvSource = process.env): string {
  const databaseUrl = loadEnv(source).databaseUrl;
  if (!databaseUrl) {
    throw new Error(
      "Missing required configuration: DATABASE_URL. PostgreSQL access is unavailable until a connection string is provided. Do not use fake credentials.",
    );
  }
  return databaseUrl;
}

export function requireAuthSecret(source: EnvSource = process.env): string {
  const authSecret = loadEnv(source).authSecret;
  if (!authSecret) {
    throw new Error(
      "Missing required configuration: AUTH_SECRET. Authentication is unavailable until a session secret is provided. Do not use fake credentials.",
    );
  }
  return authSecret;
}

export const serverSecretNames: readonly string[] = SECRET_NAMES;
