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
        AND relname IN ('users', 'profiles', 'sessions', 'follows', 'blocks', 'posts', 'comments', 'reactions', 'media', 'post_media', 'conversations', 'conversation_participants', 'messages', 'message_media', 'communities', 'community_members', 'channels', 'notifications', 'reports', 'moderation_actions')
      ORDER BY relname
    `;
    const constraints = await prisma.$queryRaw<ConstraintRow[]>`
      SELECT conname, contype::text AS contype
      FROM pg_constraint
      WHERE conrelid IN ('users'::regclass, 'profiles'::regclass, 'sessions'::regclass, 'follows'::regclass, 'blocks'::regclass, 'posts'::regclass, 'comments'::regclass, 'reactions'::regclass, 'media'::regclass, 'post_media'::regclass, 'conversations'::regclass, 'conversation_participants'::regclass, 'messages'::regclass, 'message_media'::regclass, 'communities'::regclass, 'community_members'::regclass, 'channels'::regclass, 'notifications'::regclass, 'reports'::regclass, 'moderation_actions'::regclass)
      ORDER BY conname
    `;
    const indexes = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename IN ('users', 'profiles', 'sessions', 'follows', 'blocks', 'posts', 'comments', 'reactions', 'media', 'post_media', 'conversations', 'conversation_participants', 'messages', 'message_media', 'communities', 'community_members', 'channels', 'notifications', 'reports', 'moderation_actions')
      ORDER BY indexname
    `;

    expect(tables.map((row) => row.relname)).toEqual([
      "blocks",
      "channels",
      "comments",
      "communities",
      "community_members",
      "conversation_participants",
      "conversations",
      "follows",
      "media",
      "message_media",
      "messages",
      "moderation_actions",
      "notifications",
      "post_media",
      "posts",
      "profiles",
      "reactions",
      "reports",
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
        { conname: "posts_pkey", contype: "p" },
        { conname: "comments_pkey", contype: "p" },
        { conname: "reactions_pkey", contype: "p" },
        { conname: "posts_author_id_fkey", contype: "f" },
        { conname: "comments_post_id_fkey", contype: "f" },
        { conname: "comments_author_id_fkey", contype: "f" },
        { conname: "reactions_post_id_fkey", contype: "f" },
        { conname: "reactions_user_id_fkey", contype: "f" },
        { conname: "media_pkey", contype: "p" },
        { conname: "post_media_pkey", contype: "p" },
        { conname: "media_owner_id_fkey", contype: "f" },
        { conname: "post_media_post_id_fkey", contype: "f" },
        { conname: "post_media_media_id_fkey", contype: "f" },
        { conname: "conversations_pkey", contype: "p" },
        { conname: "conversation_participants_pkey", contype: "p" },
        { conname: "messages_pkey", contype: "p" },
        { conname: "message_media_pkey", contype: "p" },
        { conname: "conversation_participants_conversation_id_fkey", contype: "f" },
        { conname: "conversation_participants_user_id_fkey", contype: "f" },
        { conname: "messages_conversation_id_fkey", contype: "f" },
        { conname: "messages_sender_id_fkey", contype: "f" },
        { conname: "message_media_message_id_fkey", contype: "f" },
        { conname: "message_media_media_id_fkey", contype: "f" },
        { conname: "communities_pkey", contype: "p" },
        { conname: "community_members_pkey", contype: "p" },
        { conname: "channels_pkey", contype: "p" },
        { conname: "communities_owner_id_fkey", contype: "f" },
        { conname: "community_members_community_id_fkey", contype: "f" },
        { conname: "community_members_user_id_fkey", contype: "f" },
        { conname: "channels_community_id_fkey", contype: "f" },
        { conname: "posts_channel_id_fkey", contype: "f" },
        { conname: "notifications_pkey", contype: "p" },
        { conname: "notifications_recipient_id_fkey", contype: "f" },
        { conname: "notifications_actor_id_fkey", contype: "f" },
        { conname: "reports_pkey", contype: "p" },
        { conname: "reports_reporter_id_fkey", contype: "f" },
        { conname: "reports_assigned_moderator_id_fkey", contype: "f" },
        { conname: "moderation_actions_pkey", contype: "p" },
        { conname: "moderation_actions_moderator_id_fkey", contype: "f" },
        { conname: "moderation_actions_report_id_fkey", contype: "f" },
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
        "posts_author_id_created_at_idx",
        "posts_created_at_id_idx",
        "comments_post_id_created_at_idx",
        "reactions_post_id_user_id_type_key",
        "media_object_key_key",
        "media_owner_id_created_at_idx",
        "post_media_media_id_key",
        "post_media_post_id_media_id_key",
        "conversations_participant_key_key",
        "conversations_last_message_at_idx",
        "conversation_participants_conversation_id_user_id_key",
        "conversation_participants_user_id_conversation_id_idx",
        "messages_conversation_id_created_at_id_idx",
        "messages_sender_id_created_at_idx",
        "messages_deleted_at_idx",
        "message_media_message_id_key",
        "message_media_media_id_key",
        "message_media_message_id_media_id_key",
        "message_media_message_id_position_idx",
        "communities_slug_normalized_key",
        "communities_visibility_created_at_id_idx",
        "communities_deleted_at_idx",
        "community_members_community_id_user_id_key",
        "community_members_user_id_community_id_idx",
        "community_members_single_active_owner",
        "channels_community_id_slug_normalized_key",
        "channels_community_id_deleted_at_idx",
        "posts_channel_id_created_at_id_idx",
        "notifications_event_key_key",
        "notifications_recipient_id_created_at_idx",
        "notifications_recipient_id_read_at_created_at_idx",
        "users_is_moderator_idx",
        "posts_hidden_at_idx",
        "comments_hidden_at_idx",
        "reports_reporter_id_active_dedupe_key_key",
        "reports_status_created_at_id_idx",
        "reports_target_type_target_id_idx",
        "reports_reporter_id_created_at_idx",
        "moderation_actions_created_at_id_idx",
        "moderation_actions_target_type_target_id_created_at_idx",
        "moderation_actions_moderator_id_created_at_idx",
        "moderation_actions_report_id_idx",
      ]),
    );
  });
});
