export const notificationTypes = [
  "FOLLOW",
  "COMMENT",
  "REACTION",
  "MESSAGE",
  "COMMUNITY_MEMBER_JOINED",
  "COMMUNITY_ROLE_CHANGED",
] as const;

export type NotificationType = (typeof notificationTypes)[number];

export const notificationLimits = {
  eventKeyMaxLength: 255,
  maxPageSize: 50,
  defaultPageSize: 20,
} as const;

export const notificationRefs = [
  "postId",
  "commentId",
  "conversationId",
  "messageId",
  "communityId",
] as const;

export type NotificationRef = (typeof notificationRefs)[number];

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === "string" &&
    (notificationTypes as readonly string[]).includes(value)
  );
}

function assertKeyLength(eventKey: string): string {
  if (eventKey.length === 0 || eventKey.length > notificationLimits.eventKeyMaxLength) {
    throw new Error("Notification event key is out of range.");
  }
  return eventKey;
}

export function followEventKey(followId: string): string {
  return assertKeyLength(`follow:${followId}`);
}

export function commentEventKey(commentId: string): string {
  return assertKeyLength(`comment:${commentId}`);
}

export function reactionEventKey(reactionId: string): string {
  return assertKeyLength(`reaction:${reactionId}`);
}

export function messageEventKey(messageId: string): string {
  return assertKeyLength(`message:${messageId}`);
}

export function communityJoinEventKey(
  membershipId: string,
  recipientId: string,
): string {
  return assertKeyLength(`community-join:${membershipId}:${recipientId}`);
}

export function communityRoleEventKey(
  membershipId: string,
  changedAt: Date,
): string {
  return assertKeyLength(
    `community-role:${membershipId}:${changedAt.toISOString()}`,
  );
}

export const NOTIFICATION_SEMANTICS = {
  scope:
    "In-app, database-backed notifications only. They are a secondary side effect of existing product events and never gate or weaken the primary mutation.",
  ownership:
    "Notifications are visible and mutable only to their recipient. Ownership is enforced server-side and other users always receive 404 so notification existence is never disclosed.",
  idempotency:
    "Every notification carries a deterministic, unique event key. Inserts use ON CONFLICT DO NOTHING so duplicates from repeated or concurrent operations are collapsed without aborting the surrounding transaction.",
  privacy:
    "Notifications never store message bodies, emails, password hashes, session data, or secrets. Only typed nullable entity identifiers are stored for navigation, and reads re-apply current block and content-access rules.",
} as const;
