import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import { requireActiveUser, getCurrentUser } from "@/lib/auth";
import {
  COMMUNITY_SEMANTICS,
  canManageChannels,
  canManageMembers,
  communityLimits,
  isChannelType,
  isCommunityRole,
  isCommunityVisibility,
  isValidCommunityName,
  isValidDescription,
  isValidSlugFormat,
  normalizeCommunityName,
  normalizeDescription,
  slugify,
  type ChannelType,
  type CommunityRole,
  type CommunityVisibility,
} from "@/lib/community-policy";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { toPublicGraphProfile, type PublicGraphProfile } from "@/lib/graph";
import { HttpError } from "@/lib/http-error";
import {
  communityJoinEventKey,
  communityRoleEventKey,
} from "@/lib/notification-policy";
import { createNotificationIfAbsent } from "@/lib/notifications";
import { decodeCursor, encodeCursor, type PageResult } from "@/lib/pagination";

export { COMMUNITY_SEMANTICS, communityLimits };

export const DEFAULT_CHANNEL_NAME = "general";
export const DEFAULT_CHANNEL_SLUG = "general";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const userSelect = {
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
} as const;

type MemberUser = {
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

type CommunityRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: CommunityVisibility;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  owner: MemberUser;
  _count: { members: number };
};

type ChannelRecord = {
  id: string;
  communityId: string;
  name: string;
  slug: string;
  description: string | null;
  type: ChannelType;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type PublicCommunity = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: CommunityVisibility;
  createdAt: Date;
  updatedAt: Date;
  owner: PublicGraphProfile | null;
  memberCount: number;
  viewerRole: CommunityRole | null;
  viewerIsMember: boolean;
};

export type PublicChannel = {
  id: string;
  communityId: string;
  name: string;
  slug: string;
  description: string | null;
  type: ChannelType;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicCommunityMember = {
  userId: string;
  role: CommunityRole;
  joinedAt: Date;
  profile: PublicGraphProfile | null;
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

function notFound(): HttpError {
  return new HttpError(404, "not_found", "Not found.");
}

function conflict(message: string): HttpError {
  return new HttpError(409, "conflict", message);
}

function toPublicProfile(user: MemberUser): PublicGraphProfile | null {
  return user.profile ? toPublicGraphProfile(user.profile) : null;
}

async function isBlockedBetween(firstId: string, secondId: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const [outgoing, incoming] = await Promise.all([
    prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId: firstId, blockedId: secondId } },
      select: { id: true },
    }),
    prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId: secondId, blockedId: firstId } },
      select: { id: true },
    }),
  ]);
  return Boolean(outgoing) || Boolean(incoming);
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

function ascendingCursor(cursor: string | null, field: "joinedAt" | "createdAt") {
  if (!cursor) {
    return {};
  }
  const decoded = decodeCursor(cursor);
  return {
    OR: [
      { [field]: { gt: decoded.createdAt } },
      { [field]: decoded.createdAt, id: { gt: decoded.id } },
    ],
  };
}

function descendingCursor(cursor: string | null) {
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

export function serializePublicCommunity(community: PublicCommunity) {
  return {
    id: community.id,
    name: community.name,
    slug: community.slug,
    description: community.description,
    visibility: community.visibility,
    createdAt: community.createdAt.toISOString(),
    updatedAt: community.updatedAt.toISOString(),
    owner: community.owner,
    memberCount: community.memberCount,
    viewerRole: community.viewerRole,
    viewerIsMember: community.viewerIsMember,
  };
}

export function serializePublicChannel(channel: PublicChannel) {
  return {
    id: channel.id,
    communityId: channel.communityId,
    name: channel.name,
    slug: channel.slug,
    description: channel.description,
    type: channel.type,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
  };
}

export function serializePublicCommunityMember(member: PublicCommunityMember) {
  return {
    userId: member.userId,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
    profile: member.profile,
  };
}

async function loadCommunityOr404(communityId: string): Promise<CommunityRecord> {
  assertId(communityId, "community id");
  const prisma = getPrismaClient();
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      visibility: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      owner: userSelect,
      _count: {
        select: {
          members: {
            where: {
              leftAt: null,
              user: { status: { not: "DELETED" }, deletedAt: null },
            },
          },
        },
      },
    },
  });
  if (!community || community.deletedAt) {
    throw notFound();
  }
  return community as unknown as CommunityRecord;
}

async function activeMembership(
  communityId: string,
  userId: string,
): Promise<{ role: CommunityRole; joinedAt: Date } | null> {
  const prisma = getPrismaClient();
  const membership = await prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId, userId } },
    select: { role: true, joinedAt: true, leftAt: true },
  });
  if (!membership || membership.leftAt) {
    return null;
  }
  return { role: membership.role as CommunityRole, joinedAt: membership.joinedAt };
}

async function assertVisible(
  community: CommunityRecord,
  viewerId: string | null,
): Promise<void> {
  if (viewerId && community.owner.id !== viewerId) {
    if (await isBlockedBetween(viewerId, community.owner.id)) {
      throw notFound();
    }
  }
  if (community.visibility === "PRIVATE") {
    if (!viewerId) {
      throw notFound();
    }
    const membership = await activeMembership(community.id, viewerId);
    if (!membership) {
      throw notFound();
    }
  }
}

async function requireActiveMembership(
  communityId: string,
  userId: string,
  message = "You are not a member of this community.",
): Promise<CommunityRole> {
  const membership = await activeMembership(communityId, userId);
  if (!membership) {
    throw new HttpError(403, "forbidden", message);
  }
  return membership.role;
}

async function requireChannelManager(
  communityId: string,
  userId: string,
): Promise<CommunityRole> {
  const role = await requireActiveMembership(communityId, userId);
  if (!canManageChannels(role)) {
    throw new HttpError(403, "forbidden", "You cannot manage channels.");
  }
  return role;
}

function buildCommunity(
  community: CommunityRecord,
  viewerRole: CommunityRole | null,
): PublicCommunity {
  return {
    id: community.id,
    name: community.name,
    slug: community.slug,
    description: community.description,
    visibility: community.visibility,
    createdAt: community.createdAt,
    updatedAt: community.updatedAt,
    owner: toPublicProfile(community.owner),
    memberCount: community._count.members,
    viewerRole,
    viewerIsMember: viewerRole !== null,
  };
}

function readName(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      [field]: `${field} is required.`,
    });
  }
  const name = normalizeCommunityName(value);
  if (name.length === 0) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      [field]: `${field} must not be blank.`,
    });
  }
  if (Array.from(name).length > maxLength) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      [field]: `${field} must be at most ${maxLength} characters.`,
    });
  }
  return name;
}

function readDescription(
  value: unknown,
  maxLength: number,
): { value: string | null; present: boolean } {
  const present = value !== undefined;
  const description = normalizeDescription(value);
  if (description !== null && Array.from(description).length > maxLength) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      description: `description must be at most ${maxLength} characters.`,
    });
  }
  return { value: description, present };
}

function resolveSlug(name: string, rawSlug: unknown): string {
  if (rawSlug === undefined || rawSlug === null) {
    const derived = slugify(name);
    if (!isValidSlugFormat(derived)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        slug: "A valid slug could not be derived from the name.",
      });
    }
    return derived;
  }
  if (typeof rawSlug !== "string") {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      slug: "slug must be a string.",
    });
  }
  const slug = rawSlug.trim().toLowerCase();
  if (!isValidSlugFormat(slug)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      slug: "slug must contain only lowercase letters, numbers, and hyphens.",
    });
  }
  return slug;
}

export async function createCommunity(
  sessionToken: string | undefined,
  input: { name: unknown; description?: unknown; slug?: unknown; visibility?: unknown },
): Promise<PublicCommunity> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const name = readName(
    input.name,
    communityLimits.communityNameMaxLength,
    "name",
  );
  if (!isValidCommunityName(name)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      name: "name is invalid.",
    });
  }
  const { value: description } = readDescription(
    input.description,
    communityLimits.descriptionMaxLength,
  );
  if (!isValidDescription(description)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      description: "description is invalid.",
    });
  }
  const slug = resolveSlug(name, input.slug);
  let visibility: CommunityVisibility = "PUBLIC";
  if (input.visibility !== undefined && input.visibility !== null) {
    if (!isCommunityVisibility(input.visibility)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        visibility: "visibility must be PUBLIC or PRIVATE.",
      });
    }
    visibility = input.visibility;
  }

  const prisma = getPrismaClient();
  try {
    const created = await prisma.$transaction(async (tx) => {
      const community = await tx.community.create({
        data: {
          ownerId: actor.id,
          name,
          slug,
          slugNormalized: slug,
          description,
          visibility,
        },
      });
      await tx.communityMember.create({
        data: {
          communityId: community.id,
          userId: actor.id,
          role: "OWNER",
        },
      });
      await tx.channel.create({
        data: {
          communityId: community.id,
          name: DEFAULT_CHANNEL_NAME,
          slug: DEFAULT_CHANNEL_SLUG,
          slugNormalized: DEFAULT_CHANNEL_SLUG,
          type: "TEXT",
        },
      });
      return community.id;
    });
    const community = await loadCommunityOr404(created);
    return buildCommunity(community, "OWNER");
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw conflict("A community with that slug already exists.");
    }
    throw error;
  }
}

export async function listCommunities(
  sessionToken: string | undefined,
  params: { limit: number; cursor: string | null; query: string | null },
): Promise<PageResult<PublicCommunity>> {
  requireDatabaseConfigured();
  const viewer = await getCurrentUser(sessionToken);
  const prisma = getPrismaClient();
  const hidden = viewer ? await blockedUserIds(viewer.id) : [];

  const communityQuery = params.query
    ? {
        OR: [
          { slugNormalized: { startsWith: params.query.toLowerCase() } },
          { name: { contains: params.query, mode: "insensitive" as const } },
        ],
      }
    : {};

  const rows = await prisma.community.findMany({
    where: {
      visibility: "PUBLIC",
      deletedAt: null,
      owner: {
        status: { not: "DELETED" },
        deletedAt: null,
        ...(hidden.length > 0 ? { id: { notIn: hidden } } : {}),
      },
      ...communityQuery,
      ...descendingCursor(params.cursor),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.limit + 1,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      visibility: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      owner: userSelect,
      _count: {
        select: {
          members: {
            where: {
              leftAt: null,
              user: { status: { not: "DELETED" }, deletedAt: null },
            },
          },
        },
      },
    },
  });

  const page = rows.slice(0, params.limit) as unknown as CommunityRecord[];
  const items: PublicCommunity[] = [];
  for (const row of page) {
    let viewerRole: CommunityRole | null = null;
    if (viewer) {
      const membership = await activeMembership(row.id, viewer.id);
      viewerRole = membership?.role ?? null;
    }
    items.push(buildCommunity(row, viewerRole));
  }
  const lastRow = page[page.length - 1];
  return {
    items,
    nextCursor:
      rows.length > params.limit && lastRow
        ? encodeCursor(lastRow.createdAt, lastRow.id)
        : null,
  };
}

export async function getCommunity(
  sessionToken: string | undefined,
  communityId: string,
): Promise<PublicCommunity> {
  requireDatabaseConfigured();
  const viewer = await getCurrentUser(sessionToken);
  const community = await loadCommunityOr404(communityId);
  await assertVisible(community, viewer?.id ?? null);
  const membership = viewer ? await activeMembership(communityId, viewer.id) : null;
  return buildCommunity(community, membership?.role ?? null);
}

export async function updateCommunity(
  sessionToken: string | undefined,
  communityId: string,
  input: { name?: unknown; description?: unknown; visibility?: unknown },
): Promise<PublicCommunity> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  await loadCommunityOr404(communityId);
  const role = await requireActiveMembership(communityId, actor.id);

  const data: {
    name?: string;
    slug?: string;
    slugNormalized?: string;
    description?: string | null;
    visibility?: CommunityVisibility;
  } = {};

  if (input.name !== undefined) {
    const name = readName(
      input.name,
      communityLimits.communityNameMaxLength,
      "name",
    );
    if (!isValidCommunityName(name)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        name: "name is invalid.",
      });
    }
    data.name = name;
    const slug = resolveSlug(name, undefined);
    data.slug = slug;
    data.slugNormalized = slug;
  }

  if (input.description !== undefined) {
    const description = normalizeDescription(input.description);
    if (!isValidDescription(description)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        description: "description is invalid.",
      });
    }
    data.description = description;
  }

  if (input.visibility !== undefined) {
    if (role !== "OWNER") {
      throw new HttpError(403, "forbidden", "Only the owner can change visibility.");
    }
    if (!isCommunityVisibility(input.visibility)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        visibility: "visibility must be PUBLIC or PRIVATE.",
      });
    }
    data.visibility = input.visibility;
  }

  if (Object.keys(data).length === 0) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      body: "No supported fields were provided.",
    });
  }

  const prisma = getPrismaClient();
  try {
    await prisma.community.update({ where: { id: communityId }, data });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw conflict("A community with that slug already exists.");
    }
    throw error;
  }
  const updated = await loadCommunityOr404(communityId);
  return buildCommunity(updated, role);
}

export async function deleteCommunity(
  sessionToken: string | undefined,
  communityId: string,
): Promise<void> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  await loadCommunityOr404(communityId);
  const role = await requireActiveMembership(communityId, actor.id);
  if (role !== "OWNER") {
    throw new HttpError(403, "forbidden", "Only the owner can delete this community.");
  }
  const prisma = getPrismaClient();
  await prisma.community.update({
    where: { id: communityId },
    data: { deletedAt: new Date() },
  });
}

export async function joinCommunity(
  sessionToken: string | undefined,
  communityId: string,
): Promise<PublicCommunity> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const community = await loadCommunityOr404(communityId);
  const prisma = getPrismaClient();

  if (await isBlockedBetween(actor.id, community.owner.id)) {
    throw notFound();
  }
  if (community.visibility !== "PUBLIC") {
    throw notFound();
  }

  await prisma.$transaction(async (tx) => {
    const membership = await tx.communityMember.upsert({
      where: { communityId_userId: { communityId, userId: actor.id } },
      create: { communityId, userId: actor.id, role: "MEMBER" },
      update: { leftAt: null },
      select: { id: true },
    });
    const staff = await tx.communityMember.findMany({
      where: {
        communityId,
        leftAt: null,
        role: { in: ["OWNER", "ADMIN"] },
        userId: { not: actor.id },
        user: { status: { not: "DELETED" }, deletedAt: null },
      },
      select: { userId: true },
    });
    for (const recipient of staff) {
      await createNotificationIfAbsent(
        {
          recipientId: recipient.userId,
          actorId: actor.id,
          type: "COMMUNITY_MEMBER_JOINED",
          eventKey: communityJoinEventKey(membership.id, recipient.userId),
          communityId,
        },
        tx,
      );
    }
  });
  const refreshed = await loadCommunityOr404(communityId);
  const membership = await activeMembership(communityId, actor.id);
  return buildCommunity(refreshed, membership?.role ?? "MEMBER");
}

export async function leaveCommunity(
  sessionToken: string | undefined,
  communityId: string,
): Promise<void> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  await loadCommunityOr404(communityId);
  const role = await requireActiveMembership(communityId, actor.id);
  if (role === "OWNER") {
    throw conflict("Transfer ownership before leaving the community.");
  }
  const prisma = getPrismaClient();
  await prisma.communityMember.update({
    where: { communityId_userId: { communityId, userId: actor.id } },
    data: { leftAt: new Date() },
  });
}

export async function getMembership(
  sessionToken: string | undefined,
  communityId: string,
): Promise<{
  communityId: string;
  isMember: boolean;
  role: CommunityRole | null;
  joinedAt: Date | null;
}> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const community = await loadCommunityOr404(communityId);
  const membership = await activeMembership(communityId, actor.id);
  if (!membership && community.visibility === "PRIVATE") {
    if (await isBlockedBetween(actor.id, community.owner.id)) {
      throw notFound();
    }
    throw notFound();
  }
  return {
    communityId,
    isMember: membership !== null,
    role: membership?.role ?? null,
    joinedAt: membership?.joinedAt ?? null,
  };
}

export async function listMembers(
  sessionToken: string | undefined,
  communityId: string,
  params: { limit: number; cursor: string | null },
): Promise<PageResult<PublicCommunityMember>> {
  requireDatabaseConfigured();
  const viewer = await getCurrentUser(sessionToken);
  const community = await loadCommunityOr404(communityId);
  await assertVisible(community, viewer?.id ?? null);
  const hidden = viewer ? await blockedUserIds(viewer.id) : [];

  const prisma = getPrismaClient();
  const rows = await prisma.communityMember.findMany({
    where: {
      communityId,
      leftAt: null,
      user: {
        status: { not: "DELETED" },
        deletedAt: null,
        ...(hidden.length > 0 ? { id: { notIn: hidden } } : {}),
      },
      ...ascendingCursor(params.cursor, "joinedAt"),
    },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    take: params.limit + 1,
    select: {
      id: true,
      userId: true,
      role: true,
      joinedAt: true,
      user: userSelect,
    },
  });

  const page = rows.slice(0, params.limit);
  const items: PublicCommunityMember[] = page.map((row) => ({
    userId: row.userId,
    role: row.role as CommunityRole,
    joinedAt: row.joinedAt,
    profile: toPublicProfile(row.user as MemberUser),
  }));
  const lastRow = page[page.length - 1];
  return {
    items,
    nextCursor:
      rows.length > params.limit && lastRow
        ? encodeCursor(lastRow.joinedAt, lastRow.id)
        : null,
  };
}

export async function updateMemberRole(
  sessionToken: string | undefined,
  communityId: string,
  targetUserId: string,
  input: { role: unknown },
): Promise<PublicCommunityMember> {
  requireDatabaseConfigured();
  assertId(targetUserId, "user id");
  const actor = await requireActiveUser(sessionToken);
  await loadCommunityOr404(communityId);
  const actorRole = await requireActiveMembership(communityId, actor.id);
  if (!canManageMembers(actorRole)) {
    throw new HttpError(403, "forbidden", "Only the owner can manage roles.");
  }
  if (!isCommunityRole(input.role)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      role: "role must be OWNER, ADMIN, or MEMBER.",
    });
  }
  const nextRole = input.role;

  const prisma = getPrismaClient();
  const target = await prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId, userId: targetUserId } },
    select: { role: true, leftAt: true, joinedAt: true, user: userSelect },
  });
  if (!target || target.leftAt || target.user.status === "DELETED" || target.user.deletedAt) {
    throw notFound();
  }

  if (targetUserId === actor.id && nextRole !== "OWNER") {
    throw conflict("The owner cannot demote themselves. Transfer ownership first.");
  }

  if (nextRole === "OWNER") {
    if (target.role === "OWNER") {
      return {
        userId: targetUserId,
        role: "OWNER",
        joinedAt: target.joinedAt,
        profile: toPublicProfile(target.user as MemberUser),
      };
    }
    await prisma.$transaction(async (tx) => {
      await tx.communityMember.update({
        where: { communityId_userId: { communityId, userId: actor.id } },
        data: { role: "ADMIN" },
      });
      const promoted = await tx.communityMember.update({
        where: { communityId_userId: { communityId, userId: targetUserId } },
        data: { role: "OWNER" },
        select: { id: true, updatedAt: true },
      });
      await tx.community.update({
        where: { id: communityId },
        data: { ownerId: targetUserId },
      });
      await createNotificationIfAbsent(
        {
          recipientId: targetUserId,
          actorId: actor.id,
          type: "COMMUNITY_ROLE_CHANGED",
          eventKey: communityRoleEventKey(promoted.id, promoted.updatedAt),
          communityId,
        },
        tx,
      );
    });
  } else {
    if (target.role === "OWNER") {
      throw conflict("The owner's role cannot be changed directly.");
    }
    if (target.role === nextRole) {
      return {
        userId: targetUserId,
        role: target.role,
        joinedAt: target.joinedAt,
        profile: toPublicProfile(target.user as MemberUser),
      };
    }
    await prisma.$transaction(async (tx) => {
      const changed = await tx.communityMember.update({
        where: { communityId_userId: { communityId, userId: targetUserId } },
        data: { role: nextRole },
        select: { id: true, updatedAt: true },
      });
      await createNotificationIfAbsent(
        {
          recipientId: targetUserId,
          actorId: actor.id,
          type: "COMMUNITY_ROLE_CHANGED",
          eventKey: communityRoleEventKey(changed.id, changed.updatedAt),
          communityId,
        },
        tx,
      );
    });
  }

  const updated = await prisma.communityMember.findUniqueOrThrow({
    where: { communityId_userId: { communityId, userId: targetUserId } },
    select: { userId: true, role: true, joinedAt: true, user: userSelect },
  });
  return {
    userId: updated.userId,
    role: updated.role as CommunityRole,
    joinedAt: updated.joinedAt,
    profile: toPublicProfile(updated.user as MemberUser),
  };
}

export async function createChannel(
  sessionToken: string | undefined,
  communityId: string,
  input: { name: unknown; type?: unknown; description?: unknown },
): Promise<PublicChannel> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  await loadCommunityOr404(communityId);
  await requireChannelManager(communityId, actor.id);

  const name = readName(input.name, communityLimits.channelNameMaxLength, "name");
  let type: ChannelType = "TEXT";
  if (input.type !== undefined && input.type !== null) {
    if (!isChannelType(input.type)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        type: "type must be TEXT or ANNOUNCEMENT.",
      });
    }
    type = input.type;
  }
  const { value: description } = readDescription(
    input.description,
    communityLimits.channelDescriptionMaxLength,
  );
  const slug = slugify(name);
  if (!isValidSlugFormat(slug)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      name: "A valid channel slug could not be derived from the name.",
    });
  }

  const prisma = getPrismaClient();
  try {
    const channel = await prisma.channel.create({
      data: {
        communityId,
        name,
        slug,
        slugNormalized: slug,
        description,
        type,
      },
    });
    return toPublicChannel(channel as unknown as ChannelRecord);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw conflict("A channel with that name already exists.");
    }
    throw error;
  }
}

function toPublicChannel(channel: ChannelRecord): PublicChannel {
  return {
    id: channel.id,
    communityId: channel.communityId,
    name: channel.name,
    slug: channel.slug,
    description: channel.description,
    type: channel.type,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}

async function loadChannelOr404(channelId: string): Promise<{
  channel: ChannelRecord;
  community: CommunityRecord;
}> {
  assertId(channelId, "channel id");
  const prisma = getPrismaClient();
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      community: {
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          visibility: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          owner: userSelect,
          _count: {
            select: {
              members: {
                where: {
                  leftAt: null,
                  user: { status: { not: "DELETED" }, deletedAt: null },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!channel || channel.deletedAt || channel.community.deletedAt) {
    throw notFound();
  }
  return {
    channel: channel as unknown as ChannelRecord,
    community: channel.community as unknown as CommunityRecord,
  };
}

export async function getChannel(
  sessionToken: string | undefined,
  channelId: string,
): Promise<{ channel: PublicChannel; community: PublicCommunity }> {
  requireDatabaseConfigured();
  const viewer = await getCurrentUser(sessionToken);
  const { channel, community } = await loadChannelOr404(channelId);
  await assertVisible(community, viewer?.id ?? null);
  const membership = viewer ? await activeMembership(community.id, viewer.id) : null;
  return {
    channel: toPublicChannel(channel),
    community: buildCommunity(community, membership?.role ?? null),
  };
}

export async function updateChannel(
  sessionToken: string | undefined,
  channelId: string,
  input: { name?: unknown; type?: unknown; description?: unknown },
): Promise<PublicChannel> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const { community } = await loadChannelOr404(channelId);
  await requireChannelManager(community.id, actor.id);

  const data: {
    name?: string;
    slug?: string;
    slugNormalized?: string;
    description?: string | null;
    type?: ChannelType;
  } = {};

  if (input.name !== undefined) {
    const name = readName(input.name, communityLimits.channelNameMaxLength, "name");
    const slug = slugify(name);
    if (!isValidSlugFormat(slug)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        name: "A valid channel slug could not be derived from the name.",
      });
    }
    data.name = name;
    data.slug = slug;
    data.slugNormalized = slug;
  }
  if (input.description !== undefined) {
    const description = normalizeDescription(input.description);
    if (!isValidDescription(description)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        description: "description is invalid.",
      });
    }
    data.description = description;
  }
  if (input.type !== undefined) {
    if (!isChannelType(input.type)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        type: "type must be TEXT or ANNOUNCEMENT.",
      });
    }
    data.type = input.type;
  }
  if (Object.keys(data).length === 0) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      body: "No supported fields were provided.",
    });
  }

  const prisma = getPrismaClient();
  try {
    const updated = await prisma.channel.update({
      where: { id: channelId },
      data,
    });
    return toPublicChannel(updated as unknown as ChannelRecord);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw conflict("A channel with that name already exists.");
    }
    throw error;
  }
}

export async function deleteChannel(
  sessionToken: string | undefined,
  channelId: string,
): Promise<void> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const { community } = await loadChannelOr404(channelId);
  await requireChannelManager(community.id, actor.id);
  const prisma = getPrismaClient();
  await prisma.channel.update({
    where: { id: channelId },
    data: { deletedAt: new Date() },
  });
}

export async function listChannels(
  sessionToken: string | undefined,
  communityId: string,
  params: { limit: number; cursor: string | null },
): Promise<PageResult<PublicChannel>> {
  requireDatabaseConfigured();
  const viewer = await getCurrentUser(sessionToken);
  const community = await loadCommunityOr404(communityId);
  await assertVisible(community, viewer?.id ?? null);

  const prisma = getPrismaClient();
  const rows = await prisma.channel.findMany({
    where: {
      communityId,
      deletedAt: null,
      ...ascendingCursor(params.cursor, "createdAt"),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: params.limit + 1,
  });
  const page = rows.slice(0, params.limit).map((row) =>
    toPublicChannel(row as unknown as ChannelRecord),
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
