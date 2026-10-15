-- CreateEnum
CREATE TYPE "CommunityVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CommunityRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('TEXT', 'ANNOUNCEMENT');

-- CreateTable
CREATE TABLE "communities" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "slug_normalized" VARCHAR(40) NOT NULL,
    "description" VARCHAR(500),
    "visibility" "CommunityVisibility" NOT NULL DEFAULT 'PUBLIC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "communities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_members" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "CommunityRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "community_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "slug_normalized" VARCHAR(40) NOT NULL,
    "description" VARCHAR(500),
    "type" "ChannelType" NOT NULL DEFAULT 'TEXT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "posts" ADD COLUMN "channel_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "communities_slug_normalized_key" ON "communities"("slug_normalized");

-- CreateIndex
CREATE INDEX "communities_visibility_created_at_id_idx" ON "communities"("visibility", "created_at", "id");

-- CreateIndex
CREATE INDEX "communities_deleted_at_idx" ON "communities"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "community_members_community_id_user_id_key" ON "community_members"("community_id", "user_id");

-- CreateIndex
CREATE INDEX "community_members_user_id_community_id_idx" ON "community_members"("user_id", "community_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_members_single_active_owner" ON "community_members"("community_id") WHERE "role" = 'OWNER' AND "left_at" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "channels_community_id_slug_normalized_key" ON "channels"("community_id", "slug_normalized");

-- CreateIndex
CREATE INDEX "channels_community_id_deleted_at_idx" ON "channels"("community_id", "deleted_at");

-- CreateIndex
CREATE INDEX "posts_channel_id_created_at_id_idx" ON "posts"("channel_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "communities" ADD CONSTRAINT "communities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
