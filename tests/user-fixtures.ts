import { randomUUID } from "node:crypto";

export function uniqueUsername(prefix = "user"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
}

export function requiredUserData(prefix = "user") {
  const email = uniqueEmail(prefix);
  return {
    email,
    emailNormalized: email,
    passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$placeholderhashvalue12$placeholderhashvalueplaceholderhashvalue12",
  };
}

export const TEST_AUTH_SECRET = "vitest-auth-secret-not-for-production-use";

export function ensureTestAuthSecret(): string {
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.trim() === "") {
    process.env.AUTH_SECRET = TEST_AUTH_SECRET;
  }
  return process.env.AUTH_SECRET;
}
