import "server-only";

import { requireActiveUser } from "@/lib/auth";
import {
  getCommunity,
  listCommunities,
} from "@/lib/communities";
import { getPrismaClient } from "@/lib/db";
import { parseSearchQuery, searchUsers } from "@/lib/discovery";
import { loadEnv } from "@/lib/env";
import {
  getGraphCounts,
  getRelationshipView,
  listFollowers,
  listFollowing,
  serializePublicGraphProfile,
  serializeRelationshipState,
  toPublicGraphProfile,
} from "@/lib/graph";
import { HttpError } from "@/lib/http-error";
import {
  AI_AGENT_LIMITS,
  AI_TOOL_NAMES,
  isAiToolName,
  isUuid,
  truncateText,
  type AiToolName,
} from "@/lib/ai/policy";
import { collectEvidence } from "@/lib/ai/context";
import type { EvidenceIndex } from "@/lib/ai/schemas";

export type ToolExecution = {
  name: AiToolName;
  result: unknown;
};

const TOOL_DESCRIPTIONS: Record<AiToolName, string> = {
  searchUsers:
    "Search discoverable Nexus users by username or display name. Blocked and deleted users are excluded.",
  searchCommunities:
    "Search public communities the viewer is allowed to see. Private communities are never listed here.",
  searchPosts:
    "Search accessible public feed posts by text. Deleted authors, blocked users, and private channel posts are excluded.",
  getAccessibleProfile:
    "Load one public profile the viewer is allowed to see, including relationship flags without revealing a block-by.",
  getAccessibleCommunity:
    "Load one community the viewer is allowed to see. Private communities return not found to non-members.",
  getUserSocialContext:
    "Load the authenticated viewer's own follow counts and a small preview of followers and following.",
};

const TOOL_PARAMETERS: Record<AiToolName, Record<string, unknown>> = {
  searchUsers: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", minLength: 1, maxLength: 80 },
    },
    required: ["query"],
  },
  searchCommunities: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", minLength: 1, maxLength: 80 },
    },
    required: ["query"],
  },
  searchPosts: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", minLength: 1, maxLength: 80 },
    },
    required: ["query"],
  },
  getAccessibleProfile: {
    type: "object",
    additionalProperties: false,
    properties: {
      userId: { type: "string" },
    },
    required: ["userId"],
  },
  getAccessibleCommunity: {
    type: "object",
    additionalProperties: false,
    properties: {
      communityId: { type: "string" },
    },
    required: ["communityId"],
  },
  getUserSocialContext: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
};

function requireDatabaseConfigured(): void {
  if (!loadEnv().databaseUrl) {
    throw new Error(
      "Missing required configuration: DATABASE_URL. PostgreSQL access is unavailable until a connection string is provided. Do not use fake credentials.",
    );
  }
}

function readQuery(args: Record<string, unknown>): string {
  if (typeof args.query !== "string") {
    throw new HttpError(400, "invalid_input", "Invalid tool arguments.", {
      query: "query is required.",
    });
  }
  return parseSearchQuery(args.query);
}

function notFoundResult(): Record<string, unknown> {
  return { found: false };
}

async function searchAccessiblePosts(
  sessionToken: string,
  query: string,
): Promise<
  Array<{
    id: string;
    body: string;
    author: { userId: string; username: string; displayName: string };
  }>
> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const prisma = getPrismaClient();
  const [outgoing, incoming, followed] = await Promise.all([
    prisma.block.findMany({
      where: { blockerId: actor.id },
      select: { blockedId: true },
    }),
    prisma.block.findMany({
      where: { blockedId: actor.id },
      select: { blockerId: true },
    }),
    prisma.follow.findMany({
      where: { followerId: actor.id },
      select: { followingId: true },
    }),
  ]);
  const hidden = [
    ...outgoing.map((row) => row.blockedId),
    ...incoming.map((row) => row.blockerId),
  ];
  const authorIds = Array.from(
    new Set([actor.id, ...followed.map((row) => row.followingId)]),
  ).filter((id) => !hidden.includes(id));

  const rows = await prisma.post.findMany({
    where: {
      deletedAt: null,
      hiddenAt: null,
      channelId: null,
      authorId: { in: authorIds },
      author: { status: "ACTIVE", deletedAt: null },
      body: { contains: query, mode: "insensitive" },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AI_AGENT_LIMITS.maxToolResultsPerCall,
    select: {
      id: true,
      body: true,
      author: {
        select: {
          profile: {
            select: {
              userId: true,
              username: true,
              displayName: true,
            },
          },
        },
      },
    },
  });

  return rows.flatMap((row) => {
    if (!row.author.profile) {
      return [];
    }
    return [
      {
        id: row.id,
        body: truncateText(row.body, AI_AGENT_LIMITS.maxPostExcerptLength),
        author: {
          userId: row.author.profile.userId,
          username: row.author.profile.username,
          displayName: row.author.profile.displayName,
        },
      },
    ];
  });
}

export function listToolDefinitions() {
  return AI_TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    parameters: TOOL_PARAMETERS[name],
  }));
}

export async function executeTool(
  sessionToken: string,
  name: string,
  args: Record<string, unknown>,
  evidence: EvidenceIndex,
): Promise<ToolExecution> {
  if (!isAiToolName(name)) {
    throw new HttpError(400, "invalid_input", "Unknown tool.");
  }

  if (name === "searchUsers") {
    const query = readQuery(args);
    const page = await searchUsers(sessionToken, query, {
      limit: AI_AGENT_LIMITS.maxToolResultsPerCall,
      cursor: null,
    });
    if (page.items.length === 0) {
      return { name, result: { items: [] } };
    }
    requireDatabaseConfigured();
    const prisma = getPrismaClient();
    const statuses = await prisma.user.findMany({
      where: { id: { in: page.items.map((item) => item.userId) } },
      select: { id: true, status: true, deletedAt: true },
    });
    const allowed = new Set(
      statuses
        .filter((row) => row.status === "ACTIVE" && row.deletedAt === null)
        .map((row) => row.id),
    );
    const items = page.items.filter((item) => allowed.has(item.userId));
    collectEvidence(evidence, { users: items });
    return {
      name,
      result: {
        items: items.map(serializePublicGraphProfile),
      },
    };
  }

  if (name === "searchCommunities") {
    const query = readQuery(args);
    const page = await listCommunities(sessionToken, {
      limit: AI_AGENT_LIMITS.maxToolResultsPerCall,
      cursor: null,
      query,
    });
    collectEvidence(evidence, { communities: page.items });
    return {
      name,
      result: {
        items: page.items.map((community) => ({
          id: community.id,
          name: community.name,
          slug: community.slug,
          description: community.description
            ? truncateText(community.description, AI_AGENT_LIMITS.maxBioLength)
            : null,
          visibility: community.visibility,
          memberCount: community.memberCount,
        })),
      },
    };
  }

  if (name === "searchPosts") {
    const query = readQuery(args);
    const items = await searchAccessiblePosts(sessionToken, query);
    collectEvidence(evidence, {
      posts: items,
      users: items.map((item) => item.author),
    });
    return { name, result: { items } };
  }

  if (name === "getAccessibleProfile") {
    if (!isUuid(args.userId)) {
      throw new HttpError(400, "invalid_input", "Invalid tool arguments.", {
        userId: "userId is invalid.",
      });
    }
    try {
      const view = await getRelationshipView(sessionToken, args.userId);
      requireDatabaseConfigured();
      const prisma = getPrismaClient();
      const row = await prisma.profile.findUnique({
        where: { userId: args.userId },
        select: {
          userId: true,
          username: true,
          displayName: true,
          bio: true,
          user: { select: { status: true, deletedAt: true } },
        },
      });
      if (!row || row.user.status !== "ACTIVE" || row.user.deletedAt) {
        return { name, result: notFoundResult() };
      }
      if (view.relationship.blocked) {
        return { name, result: notFoundResult() };
      }
      const profile = toPublicGraphProfile({
        userId: row.userId,
        username: row.username,
        displayName: row.displayName,
        bio: row.bio ? truncateText(row.bio, AI_AGENT_LIMITS.maxBioLength) : null,
      });
      collectEvidence(evidence, { users: [profile] });
      return {
        name,
        result: {
          found: true,
          profile: serializePublicGraphProfile(profile),
          relationship: serializeRelationshipState(view.relationship),
          counts: view.counts,
        },
      };
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        return { name, result: notFoundResult() };
      }
      throw error;
    }
  }

  if (name === "getAccessibleCommunity") {
    if (!isUuid(args.communityId)) {
      throw new HttpError(400, "invalid_input", "Invalid tool arguments.", {
        communityId: "communityId is invalid.",
      });
    }
    try {
      const community = await getCommunity(sessionToken, args.communityId);
      collectEvidence(evidence, { communities: [community] });
      return {
        name,
        result: {
          found: true,
          community: {
            id: community.id,
            name: community.name,
            slug: community.slug,
            description: community.description
              ? truncateText(community.description, AI_AGENT_LIMITS.maxBioLength)
              : null,
            visibility: community.visibility,
            memberCount: community.memberCount,
            viewerIsMember: community.viewerIsMember,
          },
        },
      };
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        return { name, result: notFoundResult() };
      }
      throw error;
    }
  }

  const actor = await requireActiveUser(sessionToken);
  const [counts, following, followers] = await Promise.all([
    getGraphCounts(actor.id, actor.id),
    listFollowing(actor.id, actor.id, {
      limit: AI_AGENT_LIMITS.maxToolResultsPerCall,
      cursor: null,
    }),
    listFollowers(actor.id, actor.id, {
      limit: AI_AGENT_LIMITS.maxToolResultsPerCall,
      cursor: null,
    }),
  ]);
  collectEvidence(evidence, {
    users: [...following.items, ...followers.items],
  });
  return {
    name,
    result: {
      username: actor.profile.username,
      displayName: actor.profile.displayName,
      bio: actor.profile.bio
        ? truncateText(actor.profile.bio, AI_AGENT_LIMITS.maxBioLength)
        : null,
      followerCount: counts.followerCount,
      followingCount: counts.followingCount,
      following: following.items.map(serializePublicGraphProfile),
      followers: followers.items.map(serializePublicGraphProfile),
    },
  };
}

export function serializeToolResult(execution: ToolExecution): string {
  return JSON.stringify({
    tool: execution.name,
    data: execution.result,
    untrusted: true,
  });
}
