import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { HttpError } from "@/lib/http-error";
import { normalizeUsername } from "@/lib/identity";
import {
  serializePublicGraphProfile,
  toPublicGraphProfile,
  type PublicGraphProfile,
} from "@/lib/graph";
import type { PageResult } from "@/lib/pagination";

export const DISCOVERY_POLICY = {
  search:
    "Search matches username and display name with deterministic ordering by usernameNormalized then user id. Deleted accounts are excluded. Suspended accounts remain discoverable to unblocked viewers. Blocked pairs never appear in each other's results.",
  lists:
    "Follower and following lists exclude deleted users and any user in a block relationship with the viewer. Counts include non-deleted relationships and do not reveal blocked-pair state beyond a not-found response when the viewer is blocked.",
} as const;

const MIN_QUERY_LENGTH = 1;
const MAX_QUERY_LENGTH = 80;

function requireDatabaseConfigured(): void {
  if (!loadEnv().databaseUrl) {
    throw new Error(
      "Missing required configuration: DATABASE_URL. PostgreSQL access is unavailable until a connection string is provided. Do not use fake credentials.",
    );
  }
}

export function parseSearchQuery(raw: string | null): string {
  if (raw === null || raw.trim() === "") {
    throw new HttpError(400, "invalid_input", "Search query is required.", {
      q: "q is required.",
    });
  }
  const query = raw.trim();
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    throw new HttpError(400, "invalid_input", "Search query is invalid.", {
      q: `q must be ${MIN_QUERY_LENGTH}-${MAX_QUERY_LENGTH} characters.`,
    });
  }
  return query;
}

function decodeSearchCursor(cursor: string): {
  usernameNormalized: string;
  userId: string;
} {
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new HttpError(400, "invalid_input", "Invalid pagination.", {
      cursor: "cursor is invalid.",
    });
  }
  const separator = raw.indexOf("|");
  const usernameNormalized = raw.slice(0, separator);
  const userId = raw.slice(separator + 1);
  if (!usernameNormalized || !userId) {
    throw new HttpError(400, "invalid_input", "Invalid pagination.", {
      cursor: "cursor is invalid.",
    });
  }
  return { usernameNormalized, userId };
}

function encodeSearchCursor(usernameNormalized: string, userId: string): string {
  return Buffer.from(`${usernameNormalized}|${userId}`, "utf8").toString(
    "base64url",
  );
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

export async function searchUsers(
  sessionToken: string | undefined,
  query: string,
  params: { limit: number; cursor: string | null },
): Promise<PageResult<PublicGraphProfile>> {
  requireDatabaseConfigured();
  const viewer = await getCurrentUser(sessionToken);
  const prisma = getPrismaClient();
  const hiddenIds = viewer ? await blockedUserIds(viewer.id) : [];
  const excluded = viewer ? [...hiddenIds, viewer.id] : hiddenIds;
  const normalized = normalizeUsername(query);
  const cursor = params.cursor ? decodeSearchCursor(params.cursor) : null;

  const profiles = await prisma.profile.findMany({
    where: {
      AND: [
        {
          user: {
            status: { not: "DELETED" },
            deletedAt: null,
            ...(excluded.length > 0 ? { id: { notIn: excluded } } : {}),
          },
        },
        {
          OR: [
            { usernameNormalized: { startsWith: normalized } },
            { username: { contains: query, mode: "insensitive" } },
            { displayName: { contains: query, mode: "insensitive" } },
          ],
        },
        ...(cursor
          ? [
              {
                OR: [
                  { usernameNormalized: { gt: cursor.usernameNormalized } },
                  {
                    usernameNormalized: cursor.usernameNormalized,
                    userId: { gt: cursor.userId },
                  },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ usernameNormalized: "asc" }, { userId: "asc" }],
    take: params.limit + 1,
    select: {
      userId: true,
      username: true,
      usernameNormalized: true,
      displayName: true,
      bio: true,
    },
  });

  const page = profiles.slice(0, params.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((profile) =>
      toPublicGraphProfile({
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        bio: profile.bio,
      }),
    ),
    nextCursor:
      profiles.length > params.limit && last
        ? encodeSearchCursor(last.usernameNormalized, last.userId)
        : null,
  };
}

export function serializeSearchPage(page: PageResult<PublicGraphProfile>) {
  return {
    items: page.items.map(serializePublicGraphProfile),
    nextCursor: page.nextCursor,
  };
}
