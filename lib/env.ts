import "server-only";

export type NodeEnv = "development" | "test" | "production";

export type StorageDriver = "s3";

export type Env = {
  nodeEnv: NodeEnv;
  databaseUrl: string | undefined;
  authSecret: string | undefined;
  storageDriver: string | undefined;
  s3Bucket: string | undefined;
  s3Region: string | undefined;
  s3Endpoint: string | undefined;
  s3AccessKeyId: string | undefined;
  s3SecretAccessKey: string | undefined;
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
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
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
    storageDriver: readFrom(source, "STORAGE_DRIVER"),
    s3Bucket: readFrom(source, "S3_BUCKET"),
    s3Region: readFrom(source, "S3_REGION"),
    s3Endpoint: readFrom(source, "S3_ENDPOINT"),
    s3AccessKeyId: readFrom(source, "S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: readFrom(source, "S3_SECRET_ACCESS_KEY"),
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
      { name: "STORAGE_DRIVER", configured: Boolean(env.storageDriver) },
      { name: "S3_BUCKET", configured: Boolean(env.s3Bucket) },
      { name: "S3_REGION", configured: Boolean(env.s3Region) },
      { name: "S3_ACCESS_KEY_ID", configured: Boolean(env.s3AccessKeyId) },
      { name: "S3_SECRET_ACCESS_KEY", configured: Boolean(env.s3SecretAccessKey) },
    ],
    optional: [
      { name: "S3_ENDPOINT", configured: Boolean(env.s3Endpoint) },
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

export type S3StorageConfig = {
  driver: "s3";
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function loadStorageConfig(
  source: EnvSource = process.env,
): S3StorageConfig | undefined {
  const env = loadEnv(source);
  if (!env.storageDriver) {
    return undefined;
  }

  const driver = env.storageDriver.trim().toLowerCase();
  if (driver !== "s3") {
    throw new Error(
      "Missing required configuration: STORAGE_DRIVER. Production media requires STORAGE_DRIVER=s3 with a private bucket. Local filesystem, memory, public URLs, and fake storage are not permitted.",
    );
  }

  if (
    !env.s3Bucket ||
    !env.s3Region ||
    !env.s3AccessKeyId ||
    !env.s3SecretAccessKey
  ) {
    throw new Error(
      "Missing required configuration: S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY. Object storage is unavailable until private S3-compatible credentials are provided. Do not use fake credentials.",
    );
  }

  return {
    driver: "s3",
    bucket: env.s3Bucket,
    region: env.s3Region,
    endpoint: env.s3Endpoint,
    accessKeyId: env.s3AccessKeyId,
    secretAccessKey: env.s3SecretAccessKey,
  };
}

export function requireStorageConfig(
  source: EnvSource = process.env,
): S3StorageConfig {
  const config = loadStorageConfig(source);
  if (!config) {
    throw new Error(
      "Missing required configuration: STORAGE_DRIVER. Object storage is unavailable until a private S3-compatible bucket is provided. Do not use fake credentials.",
    );
  }
  return config;
}

export const serverSecretNames: readonly string[] = SECRET_NAMES;
