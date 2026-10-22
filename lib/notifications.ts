import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { requireActiveUser } from "@/lib/auth";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { HttpError } from "@/lib/http-error";
import {
  isNotificationType,
  type NotificationType,
} from "@/lib/notification-policy";
import { decodeCursor, encodeCursor, type PageResult } from "@/lib/pagination";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DbClient = Prisma.TransactionClient;

const actorProfileSelect = {
  select: {
    userId: true,
    username: true,
    displayName: true,
    bio: true,
  },
} as const;

const notificationSelect = {
  id: true,
  recipientId: true,
  actorId: true,
  type: true,
  createdAt: true,
  readAt: true,
  postId: true,
  commentId: true,
  conversationId: true,
  messageId: true,
  communityId: true,
  actor: { select: { profile: actorProfileSelect } },
} as const;

type ActorProfile = {
  userId: string;
  username: string;
  displayName: string;
  bio: string | null;
};

type NotificationRow = {
  id: string;
  recipientId: string;
  actorId: string | null;
  type: string;
  createdAt: Date;
  readAt: Date | null;
  postId: string | null;
  commentId: string | null;
  conversationId: string | null;
  messageId: string | null;
  communityId: string | null;
  actor: { profile: ActorProfile | null } | null;
};

export type PublicNotification = {
  id: string;
  type: NotificationType;
  createdAt: Date;
  readAt: Date | null;
  actor: ActorProfile | null;
  postId: string | null;
  commentId: string | null;
  conversationId: string | null;
  messageId: string | null;
  communityId: string | null;
};

export type NotificationInput = {
  recipientId: string;
  actorId?: string | null;
  type: NotificationType;
  eventKey: string;
  postId?: string | null;
  commentId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  communityId?: string | null;
};

function requireDatabaseConfigured(): void {
  if (!loadEnv().databaseUrl) {
    throw new Error(
      "Missing required configuration: DATABASE_URL. PostgreSQL access is unavailable until a connection string is provided. Do not use fake credentials.",
    );
  }
}

function assertId(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_input", `Invalid ${label}.`);
  }
}

function notDeleted() {
  return {
    status: { not: "DELETED" as const },
    deletedAt: null,
  };
}

function cursorWhereDesc(cursor: string | null) {
  if (!cursor) {
    return {};
  }
  const decoded = decodeCursor(cursor);
  return {
    OR: [
      { createdAt: { lt: decoded.createdAt } },
      { createdAt: decoded.createdAt, id: { lt: decoded.id } },
    ],
  };
}

function visibilityWhere(hidden: string[]) {
  return {
    AND: [
      { OR: [{ actorId: null }, { actor: notDeleted() }] },
      ...(hidden.length > 0
        ? [{ OR: [{ actorId: null }, { actorId: { notIn: hidden } }] }]
        : []),
    ],
  };
}

async function blockedUserIds(
  userId: string,
  client: DbClient,
): Promise<string[]> {
  const [outgoing, incoming] = await Promise.all([
    client.block.findMany({
      where: { blockerId: userId },
      select: { blockedId: true },
    }),
    client.block.findMany({
      where: { blockedId: userId },
      select: { blockerId: true },
    }),
  ]);
  return [
    ...outgoing.map((row) => row.blockedId),
    ...incoming.map((row) => row.blockerId),
  ];
}

async function isRecipientEligible(
  recipientId: string,
  client: DbClient,
): Promise<boolean> {
  const recipient = await client.user.findUnique({
    where: { id: recipientId },
    select: { status: true, deletedAt: true },
  });
  return Boolean(
    recipient && recipient.status === "ACTIVE" && recipient.deletedAt === null,
  );
}

async function isBlockedBetween(
  firstId: string,
  secondId: string,
  client: DbClient,
): Promise<boolean> {
  const [outgoing, incoming] = await Promise.all([
    client.block.findUnique({
      where: { blockerId_blockedId: { blockerId: firstId, blockedId: secondId } },
      select: { id: true },
    }),
    client.block.findUnique({
      where: { blockerId_blockedId: { blockerId: secondId, blockedId: firstId } },
      select: { id: true },
    }),
  ]);
  return Boolean(outgoing) || Boolean(incoming);
}

async function insertNotification(
  input: NotificationInput,
  client: DbClient,
): Promise<boolean> {
  if (input.actorId && input.actorId === input.recipientId) {
    return false;
  }
  assertId(input.recipientId, "recipient id");
  if (input.actorId) {
    assertId(input.actorId, "actor id");
  }
  if (!isNotificationType(input.type)) {
    throw new HttpError(400, "invalid_input", "Invalid notification type.");
  }
  if (!(await isRecipientEligible(input.recipientId, client))) {
    return false;
  }
  if (
    input.actorId &&
    (await isBlockedBetween(input.actorId, input.recipientId, client))
  ) {
    return false;
  }

  const result = await client.notification.createMany({
    data: [
      {
        recipientId: input.recipientId,
        actorId: input.actorId ?? null,
        type: input.type,
        eventKey: input.eventKey,
        postId: input.postId ?? null,
        commentId: input.commentId ?? null,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        communityId: input.communityId ?? null,
      },
    ],
    skipDuplicates: true,
  });
  return result.count > 0;
}

export async function createNotificationIfAbsent(
  input: NotificationInput,
  client: DbClient = getPrismaClient(),
): Promise<boolean> {
  return insertNotification(input, client);
}

export async function createNotification(
  input: NotificationInput,
  client: DbClient = getPrismaClient(),
): Promise<boolean> {
  return insertNotification(input, client);
}

function toPublicNotification(row: NotificationRow): PublicNotification | null {
  if (!isNotificationType(row.type)) {
    return null;
  }
  return {
    id: row.id,
    type: row.type,
    createdAt: row.createdAt,
    readAt: row.readAt,
    actor: row.actor?.profile ?? null,
    postId: row.postId,
    commentId: row.commentId,
    conversationId: row.conversationId,
    messageId: row.messageId,
    communityId: row.communityId,
  };
}

export function serializePublicNotification(notification: PublicNotification) {
  return {
    id: notification.id,
    type: notification.type,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    actor: notification.actor,
    target: {
      postId: notification.postId,
      commentId: notification.commentId,
      conversationId: notification.conversationId,
      messageId: notification.messageId,
      communityId: notification.communityId,
    },
  };
}

function collectIds(
  rows: NotificationRow[],
  field: "postId" | "commentId" | "conversationId" | "messageId" | "communityId",
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const value = row[field];
    if (value) {
      ids.add(value);
    }
  }
  return [...ids];
}

async function filterAccessible(
  rows: NotificationRow[],
  recipientId: string,
): Promise<NotificationRow[]> {
  if (rows.length === 0) {
    return rows;
  }
  const prisma = getPrismaClient();
  const [postIds, commentIds, conversationIds, messageIds, communityIds] = [
    collectIds(rows, "postId"),
    collectIds(rows, "commentId"),
    collectIds(rows, "conversationId"),
    collectIds(rows, "messageId"),
    collectIds(rows, "communityId"),
  ];

  const [posts, comments, conversations, messages, communities] =
    await Promise.all([
      postIds.length > 0
        ? prisma.post.findMany({
            where: {
              id: { in: postIds },
              deletedAt: null,
              hiddenAt: null,
              author: notDeleted(),
            },
            select: { id: true },
          })
        : Promise.resolve([]),
      commentIds.length > 0
        ? prisma.comment.findMany({
            where: { id: { in: commentIds }, deletedAt: null, hiddenAt: null },
            select: { id: true },
          })
        : Promise.resolve([]),
      conversationIds.length > 0
        ? prisma.conversation.findMany({
            where: {
              id: { in: conversationIds },
              participants: { some: { userId: recipientId } },
            },
            select: { id: true },
          })
        : Promise.resolve([]),
      messageIds.length > 0
        ? prisma.message.findMany({
            where: { id: { in: messageIds }, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve([]),
      communityIds.length > 0
        ? prisma.community.findMany({
            where: { id: { in: communityIds }, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

  const accessiblePosts = new Set(posts.map((row) => row.id));
  const accessibleComments = new Set(comments.map((row) => row.id));
  const accessibleConversations = new Set(conversations.map((row) => row.id));
  const accessibleMessages = new Set(messages.map((row) => row.id));
  const accessibleCommunities = new Set(communities.map((row) => row.id));

  return rows.filter((row) => {
    if (!isNotificationType(row.type)) {
      return false;
    }
    switch (row.type) {
      case "FOLLOW":
        return true;
      case "COMMENT":
        return (
          (!row.postId || accessiblePosts.has(row.postId)) &&
          (!row.commentId || accessibleComments.has(row.commentId))
        );
      case "REACTION":
        return !row.postId || accessiblePosts.has(row.postId);
      case "MESSAGE":
        return (
          (!row.conversationId ||
            accessibleConversations.has(row.conversationId)) &&
          (!row.messageId || accessibleMessages.has(row.messageId))
        );
      case "COMMUNITY_MEMBER_JOINED":
      case "COMMUNITY_ROLE_CHANGED":
        return !row.communityId || accessibleCommunities.has(row.communityId);
      default:
        return false;
    }
  });
}

export async function listNotifications(
  sessionToken: string | undefined,
  params: { limit: number; cursor: string | null },
): Promise<PageResult<PublicNotification>> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const prisma = getPrismaClient();
  const hidden = await blockedUserIds(actor.id, prisma);

  const rows = (await prisma.notification.findMany({
    where: {
      recipientId: actor.id,
      ...visibilityWhere(hidden),
      ...cursorWhereDesc(params.cursor),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.limit + 1,
    select: notificationSelect,
  })) as unknown as NotificationRow[];

  const pageRows = rows.slice(0, params.limit);
  const accessible = await filterAccessible(pageRows, actor.id);
  const items = accessible.flatMap((row) => {
    const notification = toPublicNotification(row);
    return notification ? [notification] : [];
  });
  const lastRow = pageRows[pageRows.length - 1];
  return {
    items,
    nextCursor:
      rows.length > params.limit && lastRow
        ? encodeCursor(lastRow.createdAt, lastRow.id)
        : null,
  };
}

export async function getUnreadNotificationCount(
  sessionToken: string | undefined,
): Promise<number> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const prisma = getPrismaClient();
  const hidden = await blockedUserIds(actor.id, prisma);

  return prisma.notification.count({
    where: {
      recipientId: actor.id,
      readAt: null,
      ...visibilityWhere(hidden),
    },
  });
}

export async function markNotificationRead(
  sessionToken: string | undefined,
  notificationId: string,
): Promise<{ id: string; readAt: Date }> {
  requireDatabaseConfigured();
  assertId(notificationId, "notification id");
  const actor = await requireActiveUser(sessionToken);
  const prisma = getPrismaClient();
  const existing = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: {
      id: true,
      recipientId: true,
      readAt: true,
      actorId: true,
      actor: { select: { status: true, deletedAt: true } },
    },
  });
  if (!existing || existing.recipientId !== actor.id) {
    throw new HttpError(404, "not_found", "Notification not found.");
  }
  if (
    existing.actor &&
    (existing.actor.status === "DELETED" || existing.actor.deletedAt)
  ) {
    throw new HttpError(404, "not_found", "Notification not found.");
  }
  if (existing.actorId) {
    const hidden = await blockedUserIds(actor.id, prisma);
    if (hidden.includes(existing.actorId)) {
      throw new HttpError(404, "not_found", "Notification not found.");
    }
  }
  if (existing.readAt) {
    return { id: existing.id, readAt: existing.readAt };
  }
  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
    select: { id: true, readAt: true },
  });
  return { id: updated.id, readAt: updated.readAt ?? new Date() };
}

export async function markAllNotificationsRead(
  sessionToken: string | undefined,
): Promise<{ updated: number }> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const prisma = getPrismaClient();
  const hidden = await blockedUserIds(actor.id, prisma);
  const result = await prisma.notification.updateMany({
    where: {
      recipientId: actor.id,
      readAt: null,
      ...visibilityWhere(hidden),
    },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}
