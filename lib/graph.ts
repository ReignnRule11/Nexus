import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import type { UserStatus } from "@/lib/generated/prisma/client";
import { requireActiveUser } from "@/lib/auth";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { HttpError } from "@/lib/http-error";
import { followEventKey } from "@/lib/notification-policy";
import { createNotificationIfAbsent } from "@/lib/notifications";
import { decodeCursor, encodeCursor, type PageResult } from "@/lib/pagination";

export const GRAPH_SEMANTICS = {
  blockPrecedence:
    "Blocking takes precedence over following. Creating a block atomically deletes both directions of follow between the two users. Unblock does not restore follows.",
  visibility:
    "Deleted users are excluded from discovery and relationship lists. Suspended users remain visible in existing lists and search to authenticated viewers who are not blocked, but cannot create new graph relationships. Blocked pairs are hidden from each other in search, follower/following lists, and relationship payloads.",
} as const;

export type PublicGraphProfile = {
  userId: string;
  username: string;
  displayName: string;
  bio: string | null;
};

export type RelationshipState = {
  following: boolean;
  followedBy: boolean;
  blocked: boolean;
  blockedBy: boolean;
  mutual: boolean;
};

export type GraphCounts = {
  followerCount: number;
  followingCount: number;
};

type TargetUser = {
  id: string;
  status: UserStatus;
  deletedAt: Date | null;
  profile: {
    userId: string;
    username: string;
    displayName: string;
    bio: string | null;
  } | null;
};

function requireDatabaseConfigured(): void {
  if (!loadEnv().databaseUrl) {
    throw new Error(
      "Missing required configuration: DATABASE_URL. PostgreSQL access is unavailable until a connection string is provided. Do not use fake credentials.",
    );
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function assertUserId(userId: string): void {
  if (!isUuid(userId)) {
    throw new HttpError(400, "invalid_input", "Invalid user id.");
  }
}

export function toPublicGraphProfile(
  profile: NonNullable<TargetUser["profile"]>,
): PublicGraphProfile {
  return {
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
  };
}

export function serializePublicGraphProfile(profile: PublicGraphProfile) {
  return {
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
  };
}

export function serializeRelationshipState(state: RelationshipState) {
  return {
    following: state.following,
    followedBy: state.followedBy,
    blocked: state.blocked,
    blockedBy: state.blockedBy,
    mutual: state.mutual,
  };
}

function emptyRelationship(): RelationshipState {
  return {
    following: false,
    followedBy: false,
    blocked: false,
    blockedBy: false,
    mutual: false,
  };
}

function publicRelationshipForViewer(
  viewerId: string,
  targetId: string,
  state: RelationshipState,
): RelationshipState {
  if (viewerId === targetId) {
    return {
      following: false,
      followedBy: false,
      blocked: false,
      blockedBy: false,
      mutual: false,
    };
  }

  if (state.blocked) {
    return {
      following: false,
      followedBy: false,
      blocked: true,
      blockedBy: false,
      mutual: false,
    };
  }

  if (state.blockedBy) {
    return emptyRelationship();
  }

  return {
    following: state.following,
    followedBy: state.followedBy,
    blocked: false,
    blockedBy: false,
    mutual: state.following && state.followedBy,
  };
}

async function loadTargetUser(userId: string): Promise<TargetUser> {
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
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
    },
  });

  if (!user) {
    throw new HttpError(404, "not_found", "User not found.");
  }

  return user;
}

function assertTargetExists(user: TargetUser): void {
  if (user.status === "DELETED" || user.deletedAt) {
    throw new HttpError(404, "not_found", "User not found.");
  }
}

async function loadBlockPair(viewerId: string, targetId: string) {
  const prisma = getPrismaClient();
  const [blocked, blockedBy] = await Promise.all([
    prisma.block.findUnique({
      where: {
        blockerId_blockedId: { blockerId: viewerId, blockedId: targetId },
      },
      select: { id: true },
    }),
    prisma.block.findUnique({
      where: {
        blockerId_blockedId: { blockerId: targetId, blockedId: viewerId },
      },
      select: { id: true },
    }),
  ]);
  return { blocked: Boolean(blocked), blockedBy: Boolean(blockedBy) };
}

async function loadFollowPair(viewerId: string, targetId: string) {
  const prisma = getPrismaClient();
  const [following, followedBy] = await Promise.all([
    prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: viewerId,
          followingId: targetId,
        },
      },
      select: { id: true },
    }),
    prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: targetId,
          followingId: viewerId,
        },
      },
      select: { id: true },
    }),
  ]);
  return { following: Boolean(following), followedBy: Boolean(followedBy) };
}

export async function getRelationshipState(
  viewerId: string,
  targetId: string,
): Promise<RelationshipState> {
  requireDatabaseConfigured();
  assertUserId(targetId);

  if (viewerId === targetId) {
    return emptyRelationship();
  }

  const [blocks, follows] = await Promise.all([
    loadBlockPair(viewerId, targetId),
    loadFollowPair(viewerId, targetId),
  ]);

  return publicRelationshipForViewer(viewerId, targetId, {
    ...follows,
    ...blocks,
    mutual: follows.following && follows.followedBy,
  });
}

export async function followUser(
  sessionToken: string | undefined,
  targetId: string,
): Promise<RelationshipState> {
  requireDatabaseConfigured();
  assertUserId(targetId);
  const actor = await requireActiveUser(sessionToken);

  if (actor.id === targetId) {
    throw new HttpError(400, "invalid_input", "You cannot follow yourself.");
  }

  const target = await loadTargetUser(targetId);
  assertTargetExists(target);
  if (target.status !== "ACTIVE") {
    throw new HttpError(403, "account_inactive", "This account cannot be followed.");
  }

  const blocks = await loadBlockPair(actor.id, targetId);
  if (blocks.blocked || blocks.blockedBy) {
    throw new HttpError(403, "blocked", "That action is not available.");
  }

  const prisma = getPrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      const follow = await tx.follow.create({
        data: {
          followerId: actor.id,
          followingId: targetId,
        },
        select: { id: true },
      });
      await createNotificationIfAbsent(
        {
          recipientId: targetId,
          actorId: actor.id,
          type: "FOLLOW",
          eventKey: followEventKey(follow.id),
        },
        tx,
      );
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return getRelationshipState(actor.id, targetId);
    }
    throw error;
  }

  return getRelationshipState(actor.id, targetId);
}

export async function unfollowUser(
  sessionToken: string | undefined,
  targetId: string,
): Promise<RelationshipState> {
  requireDatabaseConfigured();
  assertUserId(targetId);
  const actor = await requireActiveUser(sessionToken);

  if (actor.id === targetId) {
    throw new HttpError(400, "invalid_input", "You cannot unfollow yourself.");
  }

  const prisma = getPrismaClient();
  await prisma.follow.deleteMany({
    where: { followerId: actor.id, followingId: targetId },
  });

  return getRelationshipState(actor.id, targetId);
}

export async function blockUser(
  sessionToken: string | undefined,
  targetId: string,
): Promise<RelationshipState> {
  requireDatabaseConfigured();
  assertUserId(targetId);
  const actor = await requireActiveUser(sessionToken);

  if (actor.id === targetId) {
    throw new HttpError(400, "invalid_input", "You cannot block yourself.");
  }

  const target = await loadTargetUser(targetId);
  if (target.status === "DELETED" || target.deletedAt) {
    throw new HttpError(404, "not_found", "User not found.");
  }

  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    await tx.follow.deleteMany({
      where: {
        OR: [
          { followerId: actor.id, followingId: targetId },
          { followerId: targetId, followingId: actor.id },
        ],
      },
    });

    try {
      await tx.block.create({
        data: {
          blockerId: actor.id,
          blockedId: targetId,
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
  });

  return getRelationshipState(actor.id, targetId);
}

export async function unblockUser(
  sessionToken: string | undefined,
  targetId: string,
): Promise<RelationshipState> {
  requireDatabaseConfigured();
  assertUserId(targetId);
  const actor = await requireActiveUser(sessionToken);

  if (actor.id === targetId) {
    throw new HttpError(400, "invalid_input", "You cannot unblock yourself.");
  }

  const prisma = getPrismaClient();
  await prisma.block.deleteMany({
    where: { blockerId: actor.id, blockedId: targetId },
  });

  return getRelationshipState(actor.id, targetId);
}

export async function getRelationshipView(
  sessionToken: string | undefined,
  targetId: string,
): Promise<{ relationship: RelationshipState; counts: GraphCounts | null }> {
  requireDatabaseConfigured();
  assertUserId(targetId);
  const actor = await requireActiveUser(sessionToken);
  const target = await loadTargetUser(targetId);
  assertTargetExists(target);

  const blocks = await loadBlockPair(actor.id, targetId);
  if (blocks.blockedBy) {
    throw new HttpError(404, "not_found", "User not found.");
  }

  const relationship = await getRelationshipState(actor.id, targetId);
  if (blocks.blocked) {
    return { relationship, counts: null };
  }

  return {
    relationship,
    counts: await getGraphCounts(actor.id, targetId),
  };
}

export async function getGraphCounts(
  viewerId: string | undefined,
  targetId: string,
): Promise<GraphCounts> {
  requireDatabaseConfigured();
  assertUserId(targetId);
  const target = await loadTargetUser(targetId);
  assertTargetExists(target);

  if (viewerId) {
    const blocks = await loadBlockPair(viewerId, targetId);
    if (blocks.blockedBy) {
      throw new HttpError(404, "not_found", "User not found.");
    }
  }

  const prisma = getPrismaClient();
  const activeUser = {
    status: { not: "DELETED" as const },
    deletedAt: null,
  };

  const [followerCount, followingCount] = await Promise.all([
    prisma.follow.count({
      where: {
        followingId: targetId,
        follower: activeUser,
      },
    }),
    prisma.follow.count({
      where: {
        followerId: targetId,
        following: activeUser,
      },
    }),
  ]);

  return { followerCount, followingCount };
}

const listInclude = {
  select: {
    id: true,
    createdAt: true,
    follower: {
      select: {
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
      },
    },
    following: {
      select: {
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
      },
    },
  },
} as const;

function cursorWhere(cursor: string | null) {
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

async function blockedUserIds(userId: string): Promise<Set<string>> {
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
  return new Set([
    ...outgoing.map((row) => row.blockedId),
    ...incoming.map((row) => row.blockerId),
  ]);
}

function isListableUser(user: {
  status: UserStatus;
  deletedAt: Date | null;
  profile: TargetUser["profile"];
}): boolean {
  return user.status !== "DELETED" && user.deletedAt === null && Boolean(user.profile);
}

export async function listFollowers(
  viewerId: string | undefined,
  targetId: string,
  params: { limit: number; cursor: string | null },
): Promise<PageResult<PublicGraphProfile>> {
  requireDatabaseConfigured();
  assertUserId(targetId);
  const target = await loadTargetUser(targetId);
  assertTargetExists(target);

  if (viewerId) {
    const blocks = await loadBlockPair(viewerId, targetId);
    if (blocks.blocked || blocks.blockedBy) {
      throw new HttpError(404, "not_found", "User not found.");
    }
  }

  const hidden = viewerId ? [...(await blockedUserIds(viewerId))] : [];
  const prisma = getPrismaClient();
  const rows = await prisma.follow.findMany({
    where: {
      followingId: targetId,
      follower: {
        status: { not: "DELETED" },
        deletedAt: null,
        ...(hidden.length > 0 ? { id: { notIn: hidden } } : {}),
      },
      ...cursorWhere(params.cursor),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.limit + 1,
    select: listInclude.select,
  });

  const visible = rows.filter((row) => isListableUser(row.follower));

  const page = visible.slice(0, params.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toPublicGraphProfile(row.follower.profile!)),
    nextCursor:
      visible.length > params.limit && last
        ? encodeCursor(last.createdAt, last.id)
        : null,
  };
}

export async function listFollowing(
  viewerId: string | undefined,
  targetId: string,
  params: { limit: number; cursor: string | null },
): Promise<PageResult<PublicGraphProfile>> {
  requireDatabaseConfigured();
  assertUserId(targetId);
  const target = await loadTargetUser(targetId);
  assertTargetExists(target);

  if (viewerId) {
    const blocks = await loadBlockPair(viewerId, targetId);
    if (blocks.blocked || blocks.blockedBy) {
      throw new HttpError(404, "not_found", "User not found.");
    }
  }

  const hidden = viewerId ? [...(await blockedUserIds(viewerId))] : [];
  const prisma = getPrismaClient();
  const rows = await prisma.follow.findMany({
    where: {
      followerId: targetId,
      following: {
        status: { not: "DELETED" },
        deletedAt: null,
        ...(hidden.length > 0 ? { id: { notIn: hidden } } : {}),
      },
      ...cursorWhere(params.cursor),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.limit + 1,
    select: listInclude.select,
  });

  const visible = rows.filter((row) => isListableUser(row.following));

  const page = visible.slice(0, params.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toPublicGraphProfile(row.following.profile!)),
    nextCursor:
      visible.length > params.limit && last
        ? encodeCursor(last.createdAt, last.id)
        : null,
  };
}
