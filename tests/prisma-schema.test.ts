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
    expect(schema).toContain("model Follow");
    expect(schema).toContain("model Block");
    expect(schema).toContain("model Post");
    expect(schema).toContain("model Comment");
    expect(schema).toContain("model Reaction");
    expect(schema).toContain("model Media");
    expect(schema).toContain("model PostMedia");
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
    expect(schema).toContain("passwordHash");
    expect(schema).not.toMatch(/password\s+String/);
  });

  it("stores unique normalized emails", () => {
    const schema = readFileSync(schemaPath, "utf8");

    expect(schema).toContain("emailNormalized");
    expect(schema).toMatch(/emailNormalized\s+String\s+@unique/);
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

describe("Prisma credentials migration", () => {
  const credentialsSqlPath = path.join(
    ROOT,
    "prisma",
    "migrations",
    "20261011140000_add_user_credentials",
    "migration.sql",
  );

  it("adds unique email and password hash columns", () => {
    expect(existsSync(credentialsSqlPath)).toBe(true);
    const sql = readFileSync(credentialsSqlPath, "utf8");

    expect(sql).toContain('ADD COLUMN "email" VARCHAR(254) NOT NULL');
    expect(sql).toContain('ADD COLUMN "email_normalized" VARCHAR(254) NOT NULL');
    expect(sql).toContain('ADD COLUMN "password_hash" VARCHAR(255) NOT NULL');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "users_email_normalized_key" ON "users"("email_normalized")',
    );
  });
});

describe("Prisma social graph migration", () => {
  const graphSqlPath = path.join(
    ROOT,
    "prisma",
    "migrations",
    "20261012120000_add_social_graph",
    "migration.sql",
  );

  it("creates follow and block tables with uniqueness, FKs, and self-relationship checks", () => {
    expect(existsSync(graphSqlPath)).toBe(true);
    const sql = readFileSync(graphSqlPath, "utf8");

    expect(sql).toContain('CREATE TABLE "follows"');
    expect(sql).toContain('CREATE TABLE "blocks"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "follows_follower_id_following_id_key"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "blocks_blocker_id_blocked_id_key"',
    );
    expect(sql).toContain('CREATE INDEX "follows_follower_id_created_at_idx"');
    expect(sql).toContain('CREATE INDEX "follows_following_id_created_at_idx"');
    expect(sql).toContain('CREATE INDEX "blocks_blocker_id_created_at_idx"');
    expect(sql).toContain('CREATE INDEX "profiles_display_name_idx"');
    expect(sql).toContain("CONSTRAINT \"follows_no_self\"");
    expect(sql).toContain("CONSTRAINT \"blocks_no_self\"");
    expect(sql).toContain("ON DELETE CASCADE");
  });
});

describe("Prisma posts migration", () => {
  const postsSqlPath = path.join(
    ROOT,
    "prisma",
    "migrations",
    "20261013120000_add_posts_comments_reactions",
    "migration.sql",
  );

  it("creates posts, comments, and reactions with uniqueness and feed indexes", () => {
    expect(existsSync(postsSqlPath)).toBe(true);
    const sql = readFileSync(postsSqlPath, "utf8");

    expect(sql).toContain('CREATE TABLE "posts"');
    expect(sql).toContain('CREATE TABLE "comments"');
    expect(sql).toContain('CREATE TABLE "reactions"');
    expect(sql).toContain('CREATE TYPE "ReactionType" AS ENUM (\'LIKE\')');
    expect(sql).toContain('CREATE INDEX "posts_author_id_created_at_idx"');
    expect(sql).toContain('CREATE INDEX "posts_created_at_id_idx"');
    expect(sql).toContain('CREATE INDEX "comments_post_id_created_at_idx"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "reactions_post_id_user_id_type_key"',
    );
    expect(sql).toContain("ON DELETE CASCADE");
  });
});

describe("Prisma media migration", () => {
  const mediaSqlPath = path.join(
    ROOT,
    "prisma",
    "migrations",
    "20261013180000_add_media_storage",
    "migration.sql",
  );

  it("creates media and post_media with unique object keys and FKs", () => {
    expect(existsSync(mediaSqlPath)).toBe(true);
    const sql = readFileSync(mediaSqlPath, "utf8");

    expect(sql).toContain('CREATE TABLE "media"');
    expect(sql).toContain('CREATE TABLE "post_media"');
    expect(sql).toContain(
      'CREATE TYPE "MediaStatus" AS ENUM (\'PENDING\', \'AVAILABLE\', \'FAILED\', \'DELETED\')',
    );
    expect(sql).toContain('CREATE UNIQUE INDEX "media_object_key_key"');
    expect(sql).toContain('CREATE INDEX "media_owner_id_created_at_idx"');
    expect(sql).toContain('CREATE UNIQUE INDEX "post_media_media_id_key"');
    expect(sql).toContain("ON DELETE CASCADE");
  });
});
