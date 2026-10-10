import "server-only";

import { loadEnv, type EnvSource } from "@/lib/env";

export type DatabaseHealthStatus = "ready" | "not_configured" | "unavailable";

export type DatabaseHealthResponse = {
  status: DatabaseHealthStatus;
  service: "postgres";
};

export type DatabaseHealthResult = {
  httpStatus: 200 | 503;
  body: DatabaseHealthResponse;
};

export async function getDatabaseHealth(
  source: EnvSource = process.env,
  ping: () => Promise<void> = pingDatabase,
): Promise<DatabaseHealthResult> {
  const env = loadEnv(source);

  if (!env.databaseUrl) {
    return {
      httpStatus: 503,
      body: {
        status: "not_configured",
        service: "postgres",
      },
    };
  }

  try {
    await ping();
    return {
      httpStatus: 200,
      body: {
        status: "ready",
        service: "postgres",
      },
    };
  } catch {
    return {
      httpStatus: 503,
      body: {
        status: "unavailable",
        service: "postgres",
      },
    };
  }
}

async function pingDatabase(): Promise<void> {
  const { getPrismaClient } = await import("@/lib/db");
  await getPrismaClient().$queryRaw`SELECT 1`;
}
