import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import type { MediaStatus } from "@/lib/generated/prisma/client";
import { requireActiveUser } from "@/lib/auth";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { toPublicGraphProfile, type PublicGraphProfile } from "@/lib/graph";
import { HttpError } from "@/lib/http-error";
import {
  assertAttachableMedia,
  parseMediaIds,
  serializePublicMedia,
  toPublicMedia,
  type PublicMedia,
} from "@/lib/media";
import { mediaLimits } from "@/lib/media-policy";
import { decodeCursor, encodeCursor, type PageResult } from "@/lib/pagination";

export const MESSAGING_SEMANTICS = {
  participants:
    "1:1 conversations only. Exactly two participants per conversation, enforced by a unique participant key plus a unique (conversation, user) constraint.",
  blocking:
    "Blocking takes precedence. If either participant blocks the other, the conversation is hidden (404) and new messages are rejected, so a block relationship is never disclosed through error differences.",
  privacy:
    "Non-participants always receive 404, so conversation and message existence is never disclosed. Deleted messages never reveal their original body and never return media.",
  editing:
    "Only the sender may edit or delete a message. Deletion is soft: the body is cleared and the message is returned as deleted without media.",
} as const;

export const messageLimits = {
  maxBodyLength: 4000,
} as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const profileSelect = {
  select: {
    userId: true,
    username: true,
    displayName: true,
    bio: true,
  },
} as const;

const userSelect = {
  id: true,
  status: true,
  deletedAt: true,
  profile: profileSelect,
} as const;

const senderSelect = {
  id: true,
  status: true,
  deletedAt: true,
  profile: profileSelect,
} as const;

const messageMediaSelect = {
  include: {
    media: true,
  },
} as const;

function messagesInclude() {
  return {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: {
      id: true,
      conversationId: true,
      senderId: true,
      body: true,
      createdAt: true,
      updatedAt: true,
      editedAt: true,
      deletedAt: true,
      sender: { select: senderSelect },
      messageMedia: messageMediaSelect,
    },
  };
}

function conversationInclude() {
  return {
    participants: { include: { user: { select: userSelect } } },
    messages: messagesInclude(),
  };
}

const messageInclude = {
  sender: { select: senderSelect },
  messageMedia: messageMediaSelect,
} as const;

type ParticipantUser = {
  id: string;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  deletedAt: Date | null;
  profile: {
    userId: string;
    username: string;
    displayName: string;
    bio: string | null;
  } | null;
};

type MediaRow = {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  status: MediaStatus;
  createdAt: Date;
};

type MessageRecord = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  createdAt: Date;
  updatedAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  sender: ParticipantUser;
  messageMedia: { media: MediaRow } | null;
};

type ConversationRecord = {
  id: string;
  createdAt: Date;
  lastMessageAt: Date;
  participants: Array<{ userId: string; user: ParticipantUser }>;
  messages: MessageRecord[];
};

export type PublicMessage = {
  id: string;
  conversationId: string;
  sender: PublicGraphProfile | null;
  body: string | null;
  deleted: boolean;
  edited: boolean;
  createdAt: Date;
  updatedAt: Date;
  media: PublicMedia[];
};

export type PublicConversation = {
  id: string;
  createdAt: Date;
  lastMessageAt: Date;
  participants: PublicGraphProfile[];
  otherParticipant: PublicGraphProfile | null;
  unreadCount: number;
  lastMessage: PublicMessage | null;
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

function readRequiredUserId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      userId: "A valid userId is required.",
    });
  }
  return value;
}

function canonicalParticipantKey(first: string, second: string): string {
  return [first, second].sort().join(":");
}

function notFound(): HttpError {
  return new HttpError(404, "not_found", "Not found.");
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

function conversationCursorWhereDesc(cursor: string | null) {
  if (!cursor) {
    return {};
  }
  const decoded = decodeCursor(cursor);
  return {
    OR: [
      { lastMessageAt: { lt: decoded.createdAt } },
      { lastMessageAt: decoded.createdAt, id: { lt: decoded.id } },
    ],
  };
}

function toPublicProfile(user: ParticipantUser): PublicGraphProfile | null {
  return user.profile ? toPublicGraphProfile(user.profile) : null;
}

function mediaForMessage(message: MessageRecord): PublicMedia[] {
  return message.messageMedia ? [toPublicMedia(message.messageMedia.media)] : [];
}

function toPublicMessage(message: MessageRecord): PublicMessage {
  const deleted = Boolean(message.deletedAt);
  return {
    id: message.id,
    conversationId: message.conversationId,
    sender: toPublicProfile(message.sender),
    body: deleted ? null : message.body,
    deleted,
    edited: Boolean(message.editedAt),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    media: deleted ? [] : mediaForMessage(message),
  };
}

export function serializePublicMessage(message: PublicMessage) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    sender: message.sender,
    body: message.body,
    deleted: message.deleted,
    edited: message.edited,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    media: message.media.map(serializePublicMedia),
  };
}

export function serializePublicConversation(conversation: PublicConversation) {
  return {
    id: conversation.id,
    createdAt: conversation.createdAt.toISOString(),
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    participants: conversation.participants,
    otherParticipant: conversation.otherParticipant,
    unreadCount: conversation.unreadCount,
    lastMessage: conversation.lastMessage
      ? serializePublicMessage(conversation.lastMessage)
      : null,
  };
}

async function isBlockedBetween(firstId: string, secondId: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const [blocked, blockedBy] = await Promise.all([
    prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId: firstId, blockedId: secondId } },
      select: { id: true },
    }),
    prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId: secondId, blockedId: firstId } },
      select: { id: true },
    }),
  ]);
  return Boolean(blocked) || Boolean(blockedBy);
}

async function loadParticipantOr404(conversationId: string, userId: string) {
  const prisma = getPrismaClient();
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!participant) {
    throw notFound();
  }
  return participant;
}

function otherParticipantUser(conversation: ConversationRecord, viewerId: string) {
  return conversation.participants.find((p) => p.userId !== viewerId)?.user ?? null;
}

async function assertReachable(
  conversation: ConversationRecord,
  viewerId: string,
): Promise<ParticipantUser> {
  const other = otherParticipantUser(conversation, viewerId);
  if (!other || other.status === "DELETED" || other.deletedAt) {
    throw notFound();
  }
  if (await isBlockedBetween(viewerId, other.id)) {
    throw notFound();
  }
  return other;
}

async function unreadCounts(
  viewerId: string,
  conversationIds: string[],
): Promise<Map<string, number>> {
  if (conversationIds.length === 0) {
    return new Map();
  }
  const prisma = getPrismaClient();
  const participants = await prisma.conversationParticipant.findMany({
    where: { userId: viewerId, conversationId: { in: conversationIds } },
    select: { conversationId: true, lastReadAt: true },
  });
  const counts = new Map<string, number>();
  await Promise.all(
    participants.map(async (participant) => {
      const count = await prisma.message.count({
        where: {
          conversationId: participant.conversationId,
          deletedAt: null,
          senderId: { not: viewerId },
          ...(participant.lastReadAt
            ? { createdAt: { gt: participant.lastReadAt } }
            : {}),
        },
      });
      counts.set(participant.conversationId, count);
    }),
  );
  return counts;
}

function buildSummary(
  conversation: ConversationRecord,
  viewerId: string,
  unreadCount: number,
): PublicConversation {
  const profiles = conversation.participants
    .map((participant) => toPublicProfile(participant.user))
    .filter((profile): profile is PublicGraphProfile => profile !== null);
  const other = otherParticipantUser(conversation, viewerId);
  const latest = conversation.messages[0];
  return {
    id: conversation.id,
    createdAt: conversation.createdAt,
    lastMessageAt: conversation.lastMessageAt,
    participants: profiles,
    otherParticipant: other ? toPublicProfile(other) : null,
    unreadCount,
    lastMessage: latest ? toPublicMessage(latest) : null,
  };
}

async function loadConversationById(
  where: { id: string } | { participantKey: string },
): Promise<ConversationRecord> {
  const prisma = getPrismaClient();
  const conversation = await prisma.conversation.findUnique({
    where,
    select: {
      id: true,
      createdAt: true,
      lastMessageAt: true,
      ...conversationInclude(),
    },
  });
  if (!conversation) {
    throw notFound();
  }
  return conversation as unknown as ConversationRecord;
}

export async function getOrCreateConversation(
  sessionToken: string | undefined,
  input: { userId: unknown },
): Promise<{ conversation: PublicConversation; created: boolean }> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const targetId = readRequiredUserId(input.userId);
  if (targetId === actor.id) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      userId: "You cannot start a conversation with yourself.",
    });
  }

  const prisma = getPrismaClient();
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: userSelect,
  });
  if (!target || target.status === "DELETED" || target.deletedAt) {
    throw notFound();
  }
  if (target.status === "SUSPENDED") {
    throw new HttpError(403, "account_inactive", "That account is unavailable.");
  }
  if (await isBlockedBetween(actor.id, targetId)) {
    throw notFound();
  }

  const participantKey = canonicalParticipantKey(actor.id, targetId);
  const existing = await prisma.conversation.findUnique({
    where: { participantKey },
    select: { id: true },
  });
  if (existing) {
    await prisma.conversationParticipant.updateMany({
      where: { conversationId: existing.id, userId: actor.id, hiddenAt: { not: null } },
      data: { hiddenAt: null },
    });
    const conversation = await loadConversationById({ id: existing.id });
    const unread = (await unreadCounts(actor.id, [existing.id])).get(existing.id) ?? 0;
    return { conversation: buildSummary(conversation, actor.id, unread), created: false };
  }

  try {
    const createdId = await prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({ data: { participantKey } });
      await tx.conversationParticipant.createMany({
        data: [
          { conversationId: conversation.id, userId: actor.id },
          { conversationId: conversation.id, userId: targetId },
        ],
      });
      return conversation.id;
    });
    const conversation = await loadConversationById({ id: createdId });
    return { conversation: buildSummary(conversation, actor.id, 0), created: true };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await prisma.conversation.findUnique({
        where: { participantKey },
        select: { id: true },
      });
      if (raced) {
        const conversation = await loadConversationById({ id: raced.id });
        const unread = (await unreadCounts(actor.id, [raced.id])).get(raced.id) ?? 0;
        return { conversation: buildSummary(conversation, actor.id, unread), created: false };
      }
    }
    throw error;
  }
}

export async function listConversations(
  sessionToken: string | undefined,
  params: { limit: number; cursor: string | null },
): Promise<PageResult<PublicConversation>> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const prisma = getPrismaClient();
  const rows = await prisma.conversation.findMany({
    where: {
      participants: { some: { userId: actor.id, hiddenAt: null } },
      ...conversationCursorWhereDesc(params.cursor),
    },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: params.limit + 1,
    select: {
      id: true,
      createdAt: true,
      lastMessageAt: true,
      ...conversationInclude(),
    },
  });

  const records = rows as unknown as ConversationRecord[];
  const page = records.slice(0, params.limit);
  const counts = await unreadCounts(
    actor.id,
    page.map((row) => row.id),
  );
  const items: PublicConversation[] = [];
  for (const row of page) {
    const other = otherParticipantUser(row, actor.id);
    if (other && (await isBlockedBetween(actor.id, other.id))) {
      continue;
    }
    items.push(buildSummary(row, actor.id, counts.get(row.id) ?? 0));
  }

  const lastRow = page[page.length - 1];
  return {
    items,
    nextCursor:
      rows.length > params.limit && lastRow
        ? encodeCursor(lastRow.lastMessageAt, lastRow.id)
        : null,
  };
}

export async function getConversation(
  sessionToken: string | undefined,
  conversationId: string,
): Promise<PublicConversation> {
  requireDatabaseConfigured();
  assertId(conversationId, "conversation id");
  const actor = await requireActiveUser(sessionToken);
  await loadParticipantOr404(conversationId, actor.id);
  const conversation = await loadConversationById({ id: conversationId });
  await assertReachable(conversation, actor.id);
  const unread =
    (await unreadCounts(actor.id, [conversationId])).get(conversationId) ?? 0;
  return buildSummary(conversation, actor.id, unread);
}

export async function listMessages(
  sessionToken: string | undefined,
  conversationId: string,
  params: { limit: number; cursor: string | null },
): Promise<PageResult<PublicMessage>> {
  requireDatabaseConfigured();
  assertId(conversationId, "conversation id");
  const actor = await requireActiveUser(sessionToken);
  await loadParticipantOr404(conversationId, actor.id);
  const conversation = await loadConversationById({ id: conversationId });
  await assertReachable(conversation, actor.id);

  const prisma = getPrismaClient();
  const rows = await prisma.message.findMany({
    where: { conversationId, ...cursorWhereDesc(params.cursor) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.limit + 1,
    include: messageInclude,
  });
  const page = rows
    .slice(0, params.limit)
    .map((row) => toPublicMessage(row as unknown as MessageRecord));
  const lastRow = rows[params.limit - 1];
  return {
    items: page,
    nextCursor:
      rows.length > params.limit && lastRow
        ? encodeCursor(lastRow.createdAt, lastRow.id)
        : null,
  };
}

export async function sendMessage(
  sessionToken: string | undefined,
  conversationId: string,
  input: { body?: unknown; mediaIds?: unknown },
): Promise<PublicMessage> {
  requireDatabaseConfigured();
  assertId(conversationId, "conversation id");
  const actor = await requireActiveUser(sessionToken);
  await loadParticipantOr404(conversationId, actor.id);
  const conversation = await loadConversationById({ id: conversationId });
  const recipient = await assertReachable(conversation, actor.id);
  if (recipient.status === "SUSPENDED") {
    throw new HttpError(403, "account_inactive", "That account is unavailable.");
  }

  let body: string | null = null;
  if (input.body !== undefined && input.body !== null) {
    if (typeof input.body !== "string") {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        body: "body must be a string.",
      });
    }
    if (input.body.trim().length === 0) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        body: "body must not be blank.",
      });
    }
    if (Array.from(input.body).length > messageLimits.maxBodyLength) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        body: `body must be at most ${messageLimits.maxBodyLength} characters.`,
      });
    }
    body = input.body;
  }

  const mediaIds = parseMediaIds(input.mediaIds, mediaLimits.maxAttachmentsPerMessage);
  if (body === null && mediaIds.length === 0) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      body: "A message must include a body or media.",
    });
  }
  await assertAttachableMedia(actor.id, mediaIds);

  const firstMediaId = mediaIds[0];
  const prisma = getPrismaClient();
  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: actor.id,
      body,
      messageMedia: firstMediaId
        ? { create: { mediaId: firstMediaId, position: 0 } }
        : undefined,
    },
    include: messageInclude,
  });
  await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt },
    }),
    prisma.conversationParticipant.updateMany({
      where: { conversationId, hiddenAt: { not: null } },
      data: { hiddenAt: null },
    }),
  ]);

  return toPublicMessage(message as unknown as MessageRecord);
}

async function loadVisibleMessage(
  messageId: string,
  actorId: string,
): Promise<MessageRecord> {
  assertId(messageId, "message id");
  const prisma = getPrismaClient();
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      ...messageInclude,
      conversation: { select: { id: true, participants: { select: { userId: true } } } },
    },
  });
  if (!message) {
    throw notFound();
  }
  const isParticipant = message.conversation.participants.some(
    (participant) => participant.userId === actorId,
  );
  if (!isParticipant) {
    throw notFound();
  }
  const other = message.conversation.participants.find(
    (participant) => participant.userId !== actorId,
  );
  if (other && (await isBlockedBetween(actorId, other.userId))) {
    throw notFound();
  }
  return message as unknown as MessageRecord;
}

function readRequiredBody(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      body: "body is required.",
    });
  }
  if (value.trim().length === 0) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      body: "body must not be blank.",
    });
  }
  if (Array.from(value).length > messageLimits.maxBodyLength) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      body: `body must be at most ${messageLimits.maxBodyLength} characters.`,
    });
  }
  return value;
}

export async function editMessage(
  sessionToken: string | undefined,
  messageId: string,
  input: { body: unknown },
): Promise<PublicMessage> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const message = await loadVisibleMessage(messageId, actor.id);
  if (message.deletedAt || message.senderId !== actor.id) {
    throw notFound();
  }
  const body = readRequiredBody(input.body);

  const prisma = getPrismaClient();
  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { body, editedAt: new Date() },
    include: messageInclude,
  });
  return toPublicMessage(updated as unknown as MessageRecord);
}

export async function deleteMessage(
  sessionToken: string | undefined,
  messageId: string,
): Promise<void> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const message = await loadVisibleMessage(messageId, actor.id);
  if (message.senderId !== actor.id) {
    throw notFound();
  }
  if (message.deletedAt) {
    return;
  }
  const prisma = getPrismaClient();
  await prisma.$transaction([
    prisma.messageMedia.deleteMany({ where: { messageId } }),
    prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: null },
    }),
  ]);
}

export async function markConversationRead(
  sessionToken: string | undefined,
  conversationId: string,
  input: { messageId?: unknown },
): Promise<{ unreadCount: number; lastReadAt: Date }> {
  requireDatabaseConfigured();
  assertId(conversationId, "conversation id");
  const actor = await requireActiveUser(sessionToken);
  const participant = await loadParticipantOr404(conversationId, actor.id);
  const conversation = await loadConversationById({ id: conversationId });
  await assertReachable(conversation, actor.id);
  const prisma = getPrismaClient();

  let target = new Date();
  if (input.messageId !== undefined && input.messageId !== null) {
    if (typeof input.messageId !== "string" || !UUID_PATTERN.test(input.messageId)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        messageId: "A valid messageId is required.",
      });
    }
    const message = await prisma.message.findUnique({
      where: { id: input.messageId },
      select: { conversationId: true, createdAt: true },
    });
    if (!message || message.conversationId !== conversationId) {
      throw notFound();
    }
    target = message.createdAt;
  }

  const current = participant.lastReadAt;
  const next = current && current.getTime() > target.getTime() ? current : target;
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: actor.id } },
    data: { lastReadAt: next },
  });
  return { unreadCount: 0, lastReadAt: next };
}

export async function hideConversation(
  sessionToken: string | undefined,
  conversationId: string,
): Promise<void> {
  requireDatabaseConfigured();
  assertId(conversationId, "conversation id");
  const actor = await requireActiveUser(sessionToken);
  await loadParticipantOr404(conversationId, actor.id);
  const prisma = getPrismaClient();
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: actor.id } },
    data: { hiddenAt: new Date() },
  });
}
