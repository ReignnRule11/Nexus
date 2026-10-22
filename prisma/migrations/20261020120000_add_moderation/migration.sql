-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('USER', 'POST', 'COMMENT', 'MESSAGE', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'HATE_OR_ABUSIVE_CONTENT', 'THREATS_OR_VIOLENCE', 'IMPERSONATION', 'SEXUAL_CONTENT', 'SCAM_OR_FRAUD', 'PRIVACY_VIOLATION', 'ILLEGAL_CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('CLAIM_REPORT', 'ASSIGN_REPORT', 'RESOLVE_REPORT', 'DISMISS_REPORT', 'HIDE_CONTENT', 'RESTORE_CONTENT', 'WARN_USER', 'SUSPEND_USER', 'UNSUSPEND_USER', 'VIEW_PRIVATE_MESSAGE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "is_moderator" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN "hidden_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "comments" ADD COLUMN "hidden_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "target_type" "ReportTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "explanation" VARCHAR(500),
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_moderator_id" UUID,
    "resolution_note" VARCHAR(500),
    "active_dedupe_key" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" UUID NOT NULL,
    "moderator_id" UUID NOT NULL,
    "action_type" "ModerationActionType" NOT NULL,
    "target_type" "ReportTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "report_id" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "outcome" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_is_moderator_idx" ON "users"("is_moderator");

-- CreateIndex
CREATE INDEX "posts_hidden_at_idx" ON "posts"("hidden_at");

-- CreateIndex
CREATE INDEX "comments_hidden_at_idx" ON "comments"("hidden_at");

-- CreateIndex
CREATE INDEX "reports_status_created_at_id_idx" ON "reports"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "reports_target_type_target_id_idx" ON "reports"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "reports_reporter_id_created_at_idx" ON "reports"("reporter_id", "created_at");

-- CreateIndex
CREATE INDEX "reports_assigned_moderator_id_idx" ON "reports"("assigned_moderator_id");

-- CreateIndex
CREATE INDEX "reports_reason_status_idx" ON "reports"("reason", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reports_reporter_id_active_dedupe_key_key" ON "reports"("reporter_id", "active_dedupe_key");

-- CreateIndex
CREATE INDEX "moderation_actions_created_at_id_idx" ON "moderation_actions"("created_at", "id");

-- CreateIndex
CREATE INDEX "moderation_actions_target_type_target_id_created_at_idx" ON "moderation_actions"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_actions_moderator_id_created_at_idx" ON "moderation_actions"("moderator_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_actions_report_id_idx" ON "moderation_actions"("report_id");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_assigned_moderator_id_fkey" FOREIGN KEY ("assigned_moderator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_moderator_id_fkey" FOREIGN KEY ("moderator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
