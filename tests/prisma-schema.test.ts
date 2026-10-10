import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const schemaPath = path.join(ROOT, "prisma", "schema.prisma");
const migrationDir = path.join(
  ROOT,
  "prisma",
  "migrations",
  "20261010130000_init_identity",
);
const migrationSqlPath = path.join(migrationDir, "migration.sql");
const lockPath = path.join(ROOT, "prisma", "migrations", "migration_lock.toml");

describe("Prisma identity schema", () => {
  it("exists and targets PostgreSQL", () => {
    expect(existsSync(schemaPath)).toBe(true);
    const schema = readFileSync(schemaPath, "utf8");

    expect(schema).toContain('provider = "postgresql"');
    expect(schema).toContain("model User");
    expect(schema).toContain("model Profile");
    expect(schema).toContain("model Session");
    expect(schema).not.toContain("sqlite");
  });

  it("defines one profile per user and unique usernames", () => {
    const schema = readFileSync(schemaPath, "utf8");

    expect(schema).toMatch(/userId\s+String\s+@unique/);
    expect(schema).toMatch(/usernameNormalized\s+String\s+@unique/);
    expect(schema).toContain("onDelete: Cascade");
  });

  it("stores session tokens as hashes, not plaintext secrets", () => {
    const schema = readFileSync(schemaPath, "utf8");

    expect(schema).toContain("tokenHash");
    expect(schema).not.toMatch(/token\s+String/);
    expect(schema).not.toContain("password");
  });
});

describe("Prisma identity migration", () => {
  it("includes the initial versioned migration", () => {
    expect(existsSync(migrationSqlPath)).toBe(true);
    expect(existsSync(lockPath)).toBe(true);

    const lock = readFileSync(lockPath, "utf8");
    expect(lock).toContain('provider = "postgresql"');
  });

  it("enforces identity constraints at the database level", () => {
    const sql = readFileSync(migrationSqlPath, "utf8");

    expect(sql).toContain('CREATE TABLE "users"');
    expect(sql).toContain('CREATE TABLE "profiles"');
    expect(sql).toContain('CREATE TABLE "sessions"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id")',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "profiles_username_normalized_key" ON "profiles"("username_normalized")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash")',
    );
    expect(sql).toContain('CREATE INDEX "users_status_idx"');
    expect(sql).toContain('CREATE INDEX "sessions_expires_at_idx"');
  });
});
