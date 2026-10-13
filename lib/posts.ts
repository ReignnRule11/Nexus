import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import type { ReactionType } from "@/lib/generated/prisma/client";
import { getCurrentUser, requireActiveUser } from "@/lib/auth";
import { assertAccountOwner } from "@/lib/authorization";
import {
  contentLimits,
  isValidCommentBody,
  isValidPostBody,
} from "@/lib/content";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { toPublicGraphProfile, type PublicGraphProfile } from "@/lib/graph";
import { HttpError } from "@/lib/http-error";
import {
  assertAttachableMedia,
  listPublicMediaForPost,
  parseMediaIds,
  replacePostMedia,
  serializePublicMedia,
  type PublicMedia,
} from "@/lib/media";
import {
  decodeCursor,
  encodeCursor,
  type PageParams,
  type PageResult,
} from "@/lib/pagination";

export const POST_VISIBILITY = {
  feed: "Authenticated feed includes the viewer's own posts and posts from users they follow, excluding deleted posts/authors and any user in a block relationship with the viewer. Ordering is createdAt DESC, id DESC.",
  blocks:
    "Blocked pairs cannot see each other's posts, comments, or reactions. Block filtering is enforced server-side.",
} as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const authorProfileSelect = {
  id: true,
  status: true,
  deletedAt: true,
  profile: {
    select: {
      userId: true,
      username: true,
      displayName: true,
      bio: true,
    },
  },
} as const;

type AuthorRecord = {
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

type PostRecord = {
  id: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  author: AuthorRecord;
  _count: { comments: number; reactions: number };
  reactions: Array<{ id: string }>;
};

export type PublicPost = {
  id: string;
  author: PublicGraphProfile;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  commentCount: number;
  reactionCount: number;
  viewerHasLiked: boolean;
  media: PublicMedia[];
};

export type PublicComment = {
  id: string;
  postId: string;
  author: PublicGraphProfile;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

function requireDatabaseConfigured(): void {
  if (!loadEnv().databaseUrl) {
    throw new Error(
      "Missing required configuration: DATABASE_URL. PostgreSQL access is unavailable until a connection string is provided. Do not use fake credentials.",
    );
  }
}

export function assertId(value: string, label = "id"): void {
  if (!UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_input", `Invalid ${label}.`);
  }
}

function readRequiredBody(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      [field]: `${field} is required.`,
    });
  }
  return value;
}

function parseReactionType(value: unknown): ReactionType {
  if (value === undefined || value === null || value === "") {
    return "LIKE";
  }
  if (value === "LIKE") {
    return "LIKE";
  }
  throw new HttpError(400, "invalid_input", "Invalid reaction type.", {
    type: "Supported reaction types: LIKE.",
  });
}

function notDeletedAuthor() {
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

function cursorWhereAsc(cursor: string | null) {
  if (!cursor) {
    return {};
  }
  const decoded = decodeCursor(cursor);
  return {
    OR: [
      { createdAt: { gt: decoded.createdAt } },
      { createdAt: decoded.createdAt, id: { gt: decoded.id } },
    ],
  };
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

async function followingIds(userId: string): Promise<string[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });
  return rows.map((row) => row.followingId);
}

function toPublicPost(
  post: PostRecord,
  viewerId?: string,
  media: PublicMedia[] = [],
): PublicPost {
  if (!post.author.profile) {
    throw new HttpError(500, "internal", "Something went wrong.");
  }
  return {
    id: post.id,
    author: toPublicGraphProfile(post.author.profile),
    body: post.body,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    commentCount: post._count.comments,
    reactionCount: post._count.reactions,
    viewerHasLiked: Boolean(viewerId) && post.reactions.length > 0,
    media,
  };
}

export function serializePublicPost(post: PublicPost) {
  return {
    id: post.id,
    author: post.author,
    body: post.body,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    commentCount: post.commentCount,
    reactionCount: post.reactionCount,
    viewerHasLiked: post.viewerHasLiked,
    media: post.media.map(serializePublicMedia),
  };
}

export function serializePublicComment(comment: PublicComment) {
  return {
    id: comment.id,
    postId: comment.postId,
    author: comment.author,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

function postInclude(viewerId?: string) {
  return {
    author: { select: authorProfileSelect },
    _count: {
      select: {
        comments: {
          where: {
            deletedAt: null,
            author: notDeletedAuthor(),
          },
        },
        reactions: true,
      },
    },
    reactions: viewerId
      ? {
          where: { userId: viewerId, type: "LIKE" as const },
          select: { id: true },
        }
      : false,
  };
}

function normalizePostRecord(
  post: {
    id: string;
    authorId: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    author: AuthorRecord;
    _count: { comments: number; reactions: number };
    reactions?: Array<{ id: string }> | false;
  },
): PostRecord {
  return {
    ...post,
    reactions: Array.isArray(post.reactions) ? post.reactions : [],
  };
}

async function loadVisiblePost(postId: string, viewerId?: string): Promise<PostRecord> {
  requireDatabaseConfigured();
  assertId(postId, "post id");
  const prisma = getPrismaClient();
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: postInclude(viewerId),
  });

  if (!post || post.deletedAt || post.author.status === "DELETED" || post.author.deletedAt) {
    throw new HttpError(404, "not_found", "Post not found.");
  }

  if (viewerId && viewerId !== post.authorId) {
    const hidden = await blockedUserIds(viewerId);
    if (hidden.includes(post.authorId)) {
      throw new HttpError(404, "not_found", "Post not found.");
    }
  }

  return normalizePostRecord(post);
}

async function withMedia(
  post: PostRecord,
  viewerId?: string,
): Promise<PublicPost> {
  const media = await listPublicMediaForPost(post.id);
  return toPublicPost(post, viewerId, media);
}

export async function createPost(
  sessionToken: string | undefined,
  input: { body: unknown; mediaIds?: unknown },
): Promise<PublicPost> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const body = readRequiredBody(input.body, "body");
  if (!isValidPostBody(body)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      body: `Post body must be 1-${contentLimits.postBodyMaxLength} characters.`,
    });
  }
  const mediaIds = parseMediaIds(input.mediaIds);
  await assertAttachableMedia(actor.id, mediaIds);

  const prisma = getPrismaClient();
  const post = await prisma.post.create({
    data: {
      authorId: actor.id,
      body,
    },
    include: postInclude(actor.id),
  });
  if (mediaIds.length > 0) {
    await replacePostMedia(post.id, mediaIds);
  }
  return withMedia(normalizePostRecord(post), actor.id);
}

export async function getPost(
  sessionToken: string | undefined,
  postId: string,
): Promise<PublicPost> {
  const viewer = await getCurrentUser(sessionToken);
  const post = await loadVisiblePost(postId, viewer?.id);
  return withMedia(post, viewer?.id);
}

export async function updatePost(
  sessionToken: string | undefined,
  postId: string,
  input: { body: unknown; mediaIds?: unknown },
): Promise<PublicPost> {
  requireDatabaseConfigured();
  assertId(postId, "post id");
  const actor = await requireActiveUser(sessionToken);
  const existing = await loadVisiblePost(postId, actor.id);
  assertAccountOwner(actor.id, existing.authorId);

  const body = readRequiredBody(input.body, "body");
  if (!isValidPostBody(body)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      body: `Post body must be 1-${contentLimits.postBodyMaxLength} characters.`,
    });
  }

  const prisma = getPrismaClient();
  const post = await prisma.post.update({
    where: { id: postId },
    data: { body },
    include: postInclude(actor.id),
  });
  if (input.mediaIds !== undefined) {
    const mediaIds = parseMediaIds(input.mediaIds);
    const current = await prisma.postMedia.findMany({
      where: { postId },
      select: { mediaId: true },
    });
    const currentIds = new Set(current.map((row) => row.mediaId));
    const incoming = mediaIds.filter((id) => !currentIds.has(id));
    await assertAttachableMedia(actor.id, incoming);
    const retained = mediaIds.filter((id) => currentIds.has(id));
    if (retained.length > 0) {
      const retainedRows = await prisma.media.findMany({
        where: { id: { in: retained } },
      });
      if (retainedRows.length !== retained.length) {
        throw new HttpError(400, "invalid_input", "Invalid input.", {
          mediaIds: "One or more media items were not found.",
        });
      }
      for (const row of retainedRows) {
        if (row.ownerId !== actor.id || row.status !== "AVAILABLE" || row.deletedAt) {
          throw new HttpError(400, "invalid_input", "Invalid input.", {
            mediaIds: "Media must be available before it can be attached.",
          });
        }
      }
    }
    await replacePostMedia(postId, mediaIds);
  }
  return withMedia(normalizePostRecord(post), actor.id);
}

export async function deletePost(
  sessionToken: string | undefined,
  postId: string,
): Promise<void> {
  requireDatabaseConfigured();
  assertId(postId, "post id");
  const actor = await requireActiveUser(sessionToken);
  const existing = await loadVisiblePost(postId, actor.id);
  assertAccountOwner(actor.id, existing.authorId);

  const prisma = getPrismaClient();
  await prisma.post.update({
    where: { id: postId },
    data: { deletedAt: new Date() },
  });
}

export async function getFeed(
  sessionToken: string | undefined,
  params: PageParams,
): Promise<PageResult<PublicPost>> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const [hidden, followed] = await Promise.all([
    blockedUserIds(actor.id),
    followingIds(actor.id),
  ]);
  const authorIds = Array.from(new Set([actor.id, ...followed])).filter(
    (id) => !hidden.includes(id),
  );

  const prisma = getPrismaClient();
  const rows = await prisma.post.findMany({
    where: {
      deletedAt: null,
      authorId: { in: authorIds },
      author: notDeletedAuthor(),
      ...cursorWhereDesc(params.cursor),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.limit + 1,
    include: postInclude(actor.id),
  });

  const page = await Promise.all(
    rows.slice(0, params.limit).map((row) =>
      withMedia(normalizePostRecord(row), actor.id),
    ),
  );
  const lastRow = rows[params.limit - 1];
  return {
    items: page,
    nextCursor:
      rows.length > params.limit && lastRow
        ? encodeCursor(lastRow.createdAt, lastRow.id)
        : null,
  };
}

export async function createComment(
  sessionToken: string | undefined,
  postId: string,
  input: { body: unknown },
): Promise<PublicComment> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  await loadVisiblePost(postId, actor.id);
  const body = readRequiredBody(input.body, "body");
  if (!isValidCommentBody(body)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      body: `Comment body must be 1-${contentLimits.commentBodyMaxLength} characters.`,
    });
  }

  const prisma = getPrismaClient();
  const comment = await prisma.comment.create({
    data: {
      postId,
      authorId: actor.id,
      body,
    },
    include: {
      author: { select: authorProfileSelect },
    },
  });
  if (!comment.author.profile) {
    throw new HttpError(500, "internal", "Something went wrong.");
  }
  return {
    id: comment.id,
    postId: comment.postId,
    author: toPublicGraphProfile(comment.author.profile),
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

export async function listComments(
  sessionToken: string | undefined,
  postId: string,
  params: PageParams,
): Promise<PageResult<PublicComment>> {
  const viewer = await getCurrentUser(sessionToken);
  await loadVisiblePost(postId, viewer?.id);
  const hidden = viewer ? await blockedUserIds(viewer.id) : [];
  const prisma = getPrismaClient();
  const rows = await prisma.comment.findMany({
    where: {
      postId,
      deletedAt: null,
      author: {
        ...notDeletedAuthor(),
        ...(hidden.length > 0 ? { id: { notIn: hidden } } : {}),
      },
      ...cursorWhereAsc(params.cursor),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: params.limit + 1,
    include: {
      author: { select: authorProfileSelect },
    },
  });

  const page = rows.slice(0, params.limit).flatMap((row) => {
    if (!row.author.profile) {
      return [];
    }
    return [
      {
        id: row.id,
        postId: row.postId,
        author: toPublicGraphProfile(row.author.profile),
        body: row.body,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    ];
  });
  const lastRow = rows[params.limit - 1];
  return {
    items: page,
    nextCursor:
      rows.length > params.limit && lastRow
        ? encodeCursor(lastRow.createdAt, lastRow.id)
        : null,
  };
}

async function loadOwnComment(
  commentId: string,
  actorId: string,
): Promise<{ id: string; authorId: string; postId: string; deletedAt: Date | null }> {
  assertId(commentId, "comment id");
  const prisma = getPrismaClient();
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      authorId: true,
      postId: true,
      deletedAt: true,
    },
  });
  if (!comment || comment.deletedAt) {
    throw new HttpError(404, "not_found", "Comment not found.");
  }
  await loadVisiblePost(comment.postId, actorId);
  return comment;
}

export async function updateComment(
  sessionToken: string | undefined,
  commentId: string,
  input: { body: unknown },
): Promise<PublicComment> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const existing = await loadOwnComment(commentId, actor.id);
  assertAccountOwner(actor.id, existing.authorId);
  const body = readRequiredBody(input.body, "body");
  if (!isValidCommentBody(body)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      body: `Comment body must be 1-${contentLimits.commentBodyMaxLength} characters.`,
    });
  }

  const prisma = getPrismaClient();
  const comment = await prisma.comment.update({
    where: { id: commentId },
    data: { body },
    include: {
      author: { select: authorProfileSelect },
    },
  });
  if (!comment.author.profile) {
    throw new HttpError(500, "internal", "Something went wrong.");
  }
  return {
    id: comment.id,
    postId: comment.postId,
    author: toPublicGraphProfile(comment.author.profile),
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

export async function deleteComment(
  sessionToken: string | undefined,
  commentId: string,
): Promise<void> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const existing = await loadOwnComment(commentId, actor.id);
  assertAccountOwner(actor.id, existing.authorId);
  const prisma = getPrismaClient();
  await prisma.comment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  });
}

export async function addReaction(
  sessionToken: string | undefined,
  postId: string,
  input: { type?: unknown },
): Promise<{ reactionCount: number; viewerHasLiked: boolean; type: ReactionType }> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  await loadVisiblePost(postId, actor.id);
  const type = parseReactionType(input.type);
  const prisma = getPrismaClient();

  try {
    await prisma.reaction.create({
      data: {
        postId,
        userId: actor.id,
        type,
      },
    });
  } catch (error) {
    if (
      !(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
    ) {
      throw error;
    }
  }

  const reactionCount = await prisma.reaction.count({ where: { postId } });
  return { reactionCount, viewerHasLiked: true, type };
}

export async function removeReaction(
  sessionToken: string | undefined,
  postId: string,
  input: { type?: unknown },
): Promise<{ reactionCount: number; viewerHasLiked: boolean; type: ReactionType }> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  await loadVisiblePost(postId, actor.id);
  const type = parseReactionType(input.type);
  const prisma = getPrismaClient();
  await prisma.reaction.deleteMany({
    where: { postId, userId: actor.id, type },
  });
  const reactionCount = await prisma.reaction.count({ where: { postId } });
  return { reactionCount, viewerHasLiked: false, type };
}
