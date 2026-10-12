import { afterAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";

const databaseUrl = loadEnv(process.env).databaseUrl;
const canInspect = Boolean(databaseUrl);

type RelationRow = { relname: string };
type ConstraintRow = { conname: string; contype: string };
type IndexRow = { indexname: string };

describe.skipIf(!canInspect)("migrated PostgreSQL identity schema", () => {
  let prisma: ReturnType<typeof getPrismaClient>;

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it("contains identity tables, keys, and indexes", async () => {
    prisma = getPrismaClient();

    const tables = await prisma.$queryRaw<RelationRow[]>`
      SELECT relname
      FROM pg_class
      WHERE relkind = 'r'
        AND relnamespace = 'public'::regnamespace
        AND relname IN ('users', 'profiles', 'sessions', 'follows', 'blocks')
      ORDER BY relname
    `;
    const constraints = await prisma.$queryRaw<ConstraintRow[]>`
      SELECT conname, contype::text AS contype
      FROM pg_constraint
      WHERE conrelid IN ('users'::regclass, 'profiles'::regclass, 'sessions'::regclass, 'follows'::regclass, 'blocks'::regclass)
      ORDER BY conname
    `;
    const indexes = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename IN ('users', 'profiles', 'sessions', 'follows', 'blocks')
      ORDER BY indexname
    `;

    expect(tables.map((row) => row.relname)).toEqual([
      "blocks",
      "follows",
      "profiles",
      "sessions",
      "users",
    ]);
    expect(constraints).toEqual(
      expect.arrayContaining([
        { conname: "users_pkey", contype: "p" },
        { conname: "profiles_pkey", contype: "p" },
        { conname: "sessions_pkey", contype: "p" },
        { conname: "profiles_user_id_fkey", contype: "f" },
        { conname: "sessions_user_id_fkey", contype: "f" },
        { conname: "follows_pkey", contype: "p" },
        { conname: "blocks_pkey", contype: "p" },
        { conname: "follows_follower_id_fkey", contype: "f" },
        { conname: "follows_following_id_fkey", contype: "f" },
        { conname: "blocks_blocker_id_fkey", contype: "f" },
        { conname: "blocks_blocked_id_fkey", contype: "f" },
        { conname: "follows_no_self", contype: "c" },
        { conname: "blocks_no_self", contype: "c" },
      ]),
    );
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "profiles_user_id_key",
        "profiles_username_normalized_key",
        "profiles_display_name_idx",
        "sessions_token_hash_key",
        "users_email_normalized_key",
        "users_status_idx",
        "sessions_expires_at_idx",
        "follows_follower_id_following_id_key",
        "follows_follower_id_created_at_idx",
        "follows_following_id_created_at_idx",
        "blocks_blocker_id_blocked_id_key",
        "blocks_blocker_id_created_at_idx",
        "blocks_blocked_id_created_at_idx",
      ]),
    );
  });
});
