export const reportTargetTypes = [
  "USER",
  "POST",
  "COMMENT",
  "MESSAGE",
  "COMMUNITY",
] as const;

export type ReportTargetType = (typeof reportTargetTypes)[number];

export const reportReasons = [
  "SPAM",
  "HARASSMENT",
  "HATE_OR_ABUSIVE_CONTENT",
  "THREATS_OR_VIOLENCE",
  "IMPERSONATION",
  "SEXUAL_CONTENT",
  "SCAM_OR_FRAUD",
  "PRIVACY_VIOLATION",
  "ILLEGAL_CONTENT",
  "OTHER",
] as const;

export type ReportReason = (typeof reportReasons)[number];

export const reportStatuses = [
  "OPEN",
  "UNDER_REVIEW",
  "RESOLVED",
  "DISMISSED",
] as const;

export type ReportStatus = (typeof reportStatuses)[number];

export const moderationActionTypes = [
  "CLAIM_REPORT",
  "ASSIGN_REPORT",
  "RESOLVE_REPORT",
  "DISMISS_REPORT",
  "HIDE_CONTENT",
  "RESTORE_CONTENT",
  "WARN_USER",
  "SUSPEND_USER",
  "UNSUSPEND_USER",
  "VIEW_PRIVATE_MESSAGE",
] as const;

export type ModerationActionType = (typeof moderationActionTypes)[number];

export const enforcementActionTypes = [
  "HIDE_CONTENT",
  "RESTORE_CONTENT",
  "WARN_USER",
  "SUSPEND_USER",
  "UNSUSPEND_USER",
] as const;

export type EnforcementActionType = (typeof enforcementActionTypes)[number];

export const activeReportStatuses = ["OPEN", "UNDER_REVIEW"] as const;

export const moderationLimits = {
  explanationMaxLength: 500,
  reasonNoteMaxLength: 500,
  maxRequestBytes: 8_192,
  defaultPageSize: 20,
  maxPageSize: 50,
} as const;

export function isReportTargetType(value: unknown): value is ReportTargetType {
  return (
    typeof value === "string" &&
    (reportTargetTypes as readonly string[]).includes(value)
  );
}

export function isReportReason(value: unknown): value is ReportReason {
  return (
    typeof value === "string" &&
    (reportReasons as readonly string[]).includes(value)
  );
}

export function isReportStatus(value: unknown): value is ReportStatus {
  return (
    typeof value === "string" &&
    (reportStatuses as readonly string[]).includes(value)
  );
}

export function isModerationActionType(
  value: unknown,
): value is ModerationActionType {
  return (
    typeof value === "string" &&
    (moderationActionTypes as readonly string[]).includes(value)
  );
}

export function isEnforcementActionType(
  value: unknown,
): value is EnforcementActionType {
  return (
    typeof value === "string" &&
    (enforcementActionTypes as readonly string[]).includes(value)
  );
}

export function isActiveReportStatus(status: ReportStatus): boolean {
  return status === "OPEN" || status === "UNDER_REVIEW";
}

export const MODERATION_SEMANTICS = {
  role:
    "Users are not moderators by default. isModerator is a database-backed flag, never accepted from request data, and never self-granted. The first moderator is provisioned out-of-band with UPDATE users SET is_moderator = true WHERE id = '<uuid>'; emails and founder IDs are not credentials.",
  reporting:
    "Authenticated ACTIVE users may report USER, POST, COMMENT, MESSAGE, or COMMUNITY targets they can currently access. Users cannot report their own user account or content they authored or own. Duplicate OPEN or UNDER_REVIEW reports from the same reporter for the same target are rejected by a unique (reporterId, activeDedupeKey) constraint; the key is cleared when the report leaves the active states.",
  privacy:
    "Unauthorized reporters receive 404 for private or blocked targets. Reporter endpoints never reveal moderator identity or internal notes. Queue listings never include private message bodies. Message-body review requires an explicit audited endpoint scoped to that report.",
  workflow:
    "Valid transitions are OPEN to UNDER_REVIEW, then UNDER_REVIEW to RESOLVED or DISMISSED. Resolved and dismissed reports cannot reopen. Concurrent OPEN claims use a conditional update.",
  enforcement:
    "HIDE_CONTENT and RESTORE_CONTENT apply only to posts and comments via hiddenAt and never clear owner deletedAt. WARN_USER is audit-only. SUSPEND_USER sets UserStatus SUSPENDED and deletes that user's sessions. UNSUSPEND_USER restores SUSPENDED to ACTIVE and never reactivates DELETED. Moderators cannot suspend themselves.",
  audit:
    "Every moderator decision writes an append-only ModerationAction row in the same transaction as the state change. Public APIs cannot edit or delete audit rows. This is application-level integrity in PostgreSQL, not tamper-proof storage.",
  targets:
    "Polymorphic targetId cannot use a normal PostgreSQL foreign key across USER/POST/COMMENT/MESSAGE/COMMUNITY. Target existence and authorization are enforced in the service layer.",
  notifications:
    "Phase 12 does not create notification types, does not email reporters, and does not notify reported users.",
  ai:
    "The AI Social Agent cannot file reports or execute moderation actions. No automated AI moderation is implemented.",
} as const;
