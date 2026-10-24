import "server-only";

import type { MediaStatus } from "@/lib/generated/prisma/client";
import { getCurrentUser, requireActiveUser } from "@/lib/auth";
import { assertAccountOwner } from "@/lib/authorization";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { HttpError } from "@/lib/http-error";
import {
  MEDIA_POLICY,
  createMediaObjectKey,
  isAllowedMediaByteSize,
  isAllowedMediaMimeType,
  isOpaqueObjectKey,
  mediaLimits,
  sanitizeDisplayFilename,
} from "@/lib/media-policy";
import { getObjectStorage } from "@/lib/storage";

export { MEDIA_POLICY, mediaLimits };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublicMedia = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  status: MediaStatus;
  createdAt: Date;
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

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      [field]: `${field} is required.`,
    });
  }
  return value;
}

function readRequiredByteSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      byteSize: "byteSize must be a positive integer.",
    });
  }
  return value;
}

async function blockedUserIds(userId: string): Promise<string[]> {
  const prisma = getPrismaClient();
  const [outgoing, incoming] = await Promise.all([
    prisma.block.findMany({
      where: { blockerId: userId },
      select: { blockedId: true },
    }),
    prisma.block.findMany({
      where: { blockedId: userId },
      select: { blockerId: true },
    }),
  ]);
  return [
    ...outgoing.map((row) => row.blockedId),
    ...incoming.map((row) => row.blockerId),
  ];
}

export function toPublicMedia(media: {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  status: MediaStatus;
  createdAt: Date;
}): PublicMedia {
  return {
    id: media.id,
    filename: media.originalFilename,
    mimeType: media.mimeType,
    byteSize: media.byteSize,
    status: media.status,
    createdAt: media.createdAt,
  };
}

export function serializePublicMedia(media: PublicMedia) {
  return {
    id: media.id,
    filename: media.filename,
    mimeType: media.mimeType,
    byteSize: media.byteSize,
    status: media.status,
    createdAt: media.createdAt.toISOString(),
  };
}

export function parseMediaIds(
  value: unknown,
  maxAttachments: number = mediaLimits.maxAttachmentsPerPost,
): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      mediaIds: "mediaIds must be an array of media ids.",
    });
  }
  if (value.length > maxAttachments) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      mediaIds: `At most ${maxAttachments} attachments are allowed.`,
    });
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !UUID_PATTERN.test(entry)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        mediaIds: "Each media id must be a UUID.",
      });
    }
    if (ids.includes(entry)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        mediaIds: "Duplicate media ids are not allowed.",
      });
    }
    ids.push(entry);
  }
  return ids;
}

export async function assertAttachableMedia(
  ownerId: string,
  mediaIds: string[],
): Promise<void> {
  if (mediaIds.length === 0) {
    return;
  }
  requireDatabaseConfigured();
  const prisma = getPrismaClient();
  const rows = await prisma.media.findMany({
    where: { id: { in: mediaIds } },
    include: { postMedia: true, messageMedia: true },
  });
  if (rows.length !== mediaIds.length) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      mediaIds: "One or more media items were not found.",
    });
  }
  for (const row of rows) {
    if (row.ownerId !== ownerId) {
      throw new HttpError(403, "forbidden", "You cannot attach that media.");
    }
    if (row.deletedAt || row.status === "DELETED" || row.status === "FAILED") {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        mediaIds: "Deleted or rejected media cannot be attached.",
      });
    }
    if (row.status !== "AVAILABLE") {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        mediaIds: "Media must be available before it can be attached.",
      });
    }
    if (row.postMedia || row.messageMedia) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        mediaIds: "Media is already attached.",
      });
    }
  }
}

export async function replaceMessageMedia(
  messageId: string,
  mediaIds: string[],
): Promise<void> {
  requireDatabaseConfigured();
  const prisma = getPrismaClient();
  await prisma.$transaction([
    prisma.messageMedia.deleteMany({ where: { messageId } }),
    ...mediaIds.map((mediaId, position) =>
      prisma.messageMedia.create({
        data: { messageId, mediaId, position },
      }),
    ),
  ]);
}

export async function listPublicMediaForMessage(
  messageId: string,
): Promise<PublicMedia[]> {
  requireDatabaseConfigured();
  const prisma = getPrismaClient();
  const rows = await prisma.messageMedia.findMany({
    where: {
      messageId,
      media: {
        deletedAt: null,
        status: "AVAILABLE",
      },
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { media: true },
  });
  return rows.map((row) => toPublicMedia(row.media));
}

export async function replacePostMedia(
  postId: string,
  mediaIds: string[],
): Promise<void> {
  requireDatabaseConfigured();
  const prisma = getPrismaClient();
  await prisma.$transaction([
    prisma.postMedia.deleteMany({ where: { postId } }),
    ...mediaIds.map((mediaId, position) =>
      prisma.postMedia.create({
        data: { postId, mediaId, position },
      }),
    ),
  ]);
}

export async function listPublicMediaForPost(
  postId: string,
): Promise<PublicMedia[]> {
  requireDatabaseConfigured();
  const prisma = getPrismaClient();
  const rows = await prisma.postMedia.findMany({
    where: {
      postId,
      media: {
        deletedAt: null,
        status: "AVAILABLE",
      },
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { media: true },
  });
  return rows.map((row) => toPublicMedia(row.media));
}

export async function initiateUpload(
  sessionToken: string | undefined,
  input: { filename: unknown; mimeType: unknown; byteSize: unknown },
): Promise<{
  media: PublicMedia;
  upload: {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    expiresAt: Date;
  };
}> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const storage = getObjectStorage();
  const filename = sanitizeDisplayFilename(
    readRequiredString(input.filename, "filename"),
  );
  const mimeType = readRequiredString(input.mimeType, "mimeType")
    .trim()
    .toLowerCase();
  const byteSize = readRequiredByteSize(input.byteSize);

  if (!isAllowedMediaMimeType(mimeType)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      mimeType: "Only image/jpeg, image/png, image/webp, and image/gif are allowed.",
    });
  }
  if (!isAllowedMediaByteSize(byteSize)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      byteSize: `File size must be between 1 and ${mediaLimits.maxImageBytes} bytes.`,
    });
  }

  const objectKey = createMediaObjectKey();
  if (!isOpaqueObjectKey(objectKey)) {
    throw new HttpError(500, "internal", "Something went wrong.");
  }

  const prisma = getPrismaClient();
  const media = await prisma.media.create({
    data: {
      ownerId: actor.id,
      objectKey,
      originalFilename: filename,
      mimeType,
      byteSize,
      status: "PENDING",
    },
  });

  const upload = await storage.createUploadUrl({
    objectKey,
    contentType: mimeType,
    contentLength: byteSize,
    expiresInSeconds: mediaLimits.uploadUrlTtlSeconds,
  });

  return { media: toPublicMedia(media), upload };
}

export async function completeUpload(
  sessionToken: string | undefined,
  mediaId: string,
): Promise<PublicMedia> {
  requireDatabaseConfigured();
  assertId(mediaId, "media id");
  const actor = await requireActiveUser(sessionToken);
  const storage = getObjectStorage();
  const prisma = getPrismaClient();
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media || media.deletedAt || media.status === "DELETED") {
    throw new HttpError(404, "not_found", "Media not found.");
  }
  assertAccountOwner(actor.id, media.ownerId);
  if (media.status === "AVAILABLE") {
    return toPublicMedia(media);
  }
  if (media.status !== "PENDING") {
    throw new HttpError(400, "invalid_input", "Media cannot be finalized.");
  }

  const object = await storage.headObject(media.objectKey);
  if (
    !object ||
    object.contentLength !== media.byteSize ||
    (object.contentType &&
      object.contentType.split(";")[0]?.trim().toLowerCase() !== media.mimeType)
  ) {
    await prisma.media.update({
      where: { id: mediaId },
      data: { status: "FAILED" },
    });
    throw new HttpError(400, "invalid_input", "Uploaded object could not be verified.");
  }

  const updated = await prisma.media.update({
    where: { id: mediaId },
    data: {
      status: "AVAILABLE",
      checksum: object.etag?.replaceAll('"', "") ?? null,
    },
  });
  return toPublicMedia(updated);
}

export async function getMediaAccess(
  sessionToken: string | undefined,
  mediaId: string,
): Promise<{
  media: PublicMedia;
  download: { url: string; method: "GET"; expiresAt: Date };
}> {
  requireDatabaseConfigured();
  assertId(mediaId, "media id");
  const viewer = await getCurrentUser(sessionToken);
  if (!viewer) {
    throw new HttpError(401, "unauthenticated", "Authentication required.");
  }

  const prisma = getPrismaClient();
  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    include: {
      postMedia: {
        include: {
          post: {
            select: {
              id: true,
              authorId: true,
              channelId: true,
              deletedAt: true,
              hiddenAt: true,
              author: { select: { status: true, deletedAt: true } },
              channel: {
                select: {
                  id: true,
                  deletedAt: true,
                  community: {
                    select: {
                      id: true,
                      ownerId: true,
                      visibility: true,
                      deletedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      messageMedia: {
        include: {
          message: {
            select: {
              id: true,
              deletedAt: true,
              conversation: {
                select: {
                  participants: {
                    select: { userId: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (
    !media ||
    media.deletedAt ||
    media.status !== "AVAILABLE"
  ) {
    throw new HttpError(404, "not_found", "Media not found.");
  }

  const hidden = await blockedUserIds(viewer.id);
  if (hidden.includes(media.ownerId)) {
    throw new HttpError(404, "not_found", "Media not found.");
  }

  if (media.postMedia) {
    const post = media.postMedia.post;
    if (
      post.deletedAt ||
      post.hiddenAt ||
      post.author.status === "DELETED" ||
      post.author.deletedAt
    ) {
      throw new HttpError(404, "not_found", "Media not found.");
    }
    if (post.channelId) {
      const channel = post.channel;
      if (!channel || channel.deletedAt || channel.community.deletedAt) {
        throw new HttpError(404, "not_found", "Media not found.");
      }
      if (
        viewer.id !== channel.community.ownerId &&
        hidden.includes(channel.community.ownerId)
      ) {
        throw new HttpError(404, "not_found", "Media not found.");
      }
      if (channel.community.visibility === "PRIVATE") {
        const member = await prisma.communityMember.findUnique({
          where: {
            communityId_userId: {
              communityId: channel.community.id,
              userId: viewer.id,
            },
          },
          select: { leftAt: true },
        });
        if (!member || member.leftAt) {
          throw new HttpError(404, "not_found", "Media not found.");
        }
      }
    }
  } else if (media.messageMedia) {
    const message = media.messageMedia.message;
    const isParticipant = message.conversation.participants.some(
      (participant) => participant.userId === viewer.id,
    );
    if (message.deletedAt || !isParticipant) {
      throw new HttpError(404, "not_found", "Media not found.");
    }
  } else if (media.ownerId !== viewer.id) {
    throw new HttpError(404, "not_found", "Media not found.");
  }

  const storage = getObjectStorage();
  const download = await storage.createDownloadUrl({
    objectKey: media.objectKey,
    expiresInSeconds: mediaLimits.downloadUrlTtlSeconds,
  });
  return { media: toPublicMedia(media), download };
}

export async function deleteMedia(
  sessionToken: string | undefined,
  mediaId: string,
): Promise<{ mediaDeleted: true; objectRemoved: boolean }> {
  requireDatabaseConfigured();
  assertId(mediaId, "media id");
  const actor = await requireActiveUser(sessionToken);
  const prisma = getPrismaClient();
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media || media.deletedAt || media.status === "DELETED") {
    throw new HttpError(404, "not_found", "Media not found.");
  }
  assertAccountOwner(actor.id, media.ownerId);

  await prisma.$transaction([
    prisma.postMedia.deleteMany({ where: { mediaId } }),
    prisma.messageMedia.deleteMany({ where: { mediaId } }),
    prisma.media.update({
      where: { id: mediaId },
      data: { status: "DELETED", deletedAt: new Date() },
    }),
  ]);

  try {
    const storage = getObjectStorage();
    const result = await storage.deleteObject(media.objectKey);
    return { mediaDeleted: true, objectRemoved: result.deleted || result.missing };
  } catch {
    return { mediaDeleted: true, objectRemoved: false };
  }
}
