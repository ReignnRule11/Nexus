import "server-only";

import { requireActiveUser } from "@/lib/auth";
import {
  getGraphCounts,
  listFollowers,
  listFollowing,
  serializePublicGraphProfile,
  type PublicGraphProfile,
} from "@/lib/graph";
import { AI_AGENT_LIMITS, truncateText } from "@/lib/ai/policy";
import { emptyEvidence, type EvidenceIndex } from "@/lib/ai/schemas";

export type AgentViewerContext = {
  userId: string;
  username: string;
  displayName: string;
  bio: string | null;
  followerCount: number;
  followingCount: number;
  followingPreview: PublicGraphProfile[];
  followerPreview: PublicGraphProfile[];
};

export function collectEvidence(
  evidence: EvidenceIndex,
  input: {
    users?: Array<{ userId: string; username: string; displayName: string }>;
    communities?: Array<{ id: string; name: string }>;
    posts?: Array<{ id: string; body: string }>;
  },
): void {
  for (const user of input.users ?? []) {
    if (evidence.users.size + evidence.communities.size + evidence.posts.size >= AI_AGENT_LIMITS.maxContextItems) {
      return;
    }
    if (!evidence.users.has(user.userId)) {
      evidence.users.set(user.userId, user.displayName || user.username);
    }
  }
  for (const community of input.communities ?? []) {
    if (evidence.users.size + evidence.communities.size + evidence.posts.size >= AI_AGENT_LIMITS.maxContextItems) {
      return;
    }
    if (!evidence.communities.has(community.id)) {
      evidence.communities.set(community.id, community.name);
    }
  }
  for (const post of input.posts ?? []) {
    if (evidence.users.size + evidence.communities.size + evidence.posts.size >= AI_AGENT_LIMITS.maxContextItems) {
      return;
    }
    if (!evidence.posts.has(post.id)) {
      evidence.posts.set(post.id, truncateText(post.body, AI_AGENT_LIMITS.maxSourceNameLength));
    }
  }
}

export async function loadViewerContext(
  sessionToken: string | undefined,
): Promise<{ context: AgentViewerContext; evidence: EvidenceIndex }> {
  const actor = await requireActiveUser(sessionToken);
  const [counts, following, followers] = await Promise.all([
    getGraphCounts(actor.id, actor.id),
    listFollowing(actor.id, actor.id, {
      limit: Math.min(3, AI_AGENT_LIMITS.maxToolResultsPerCall),
      cursor: null,
    }),
    listFollowers(actor.id, actor.id, {
      limit: Math.min(3, AI_AGENT_LIMITS.maxToolResultsPerCall),
      cursor: null,
    }),
  ]);

  const context: AgentViewerContext = {
    userId: actor.id,
    username: actor.profile.username,
    displayName: actor.profile.displayName,
    bio: actor.profile.bio
      ? truncateText(actor.profile.bio, AI_AGENT_LIMITS.maxBioLength)
      : null,
    followerCount: counts.followerCount,
    followingCount: counts.followingCount,
    followingPreview: following.items,
    followerPreview: followers.items,
  };

  return { context, evidence: emptyEvidence() };
}

export function serializeViewerContext(context: AgentViewerContext) {
  return {
    username: context.username,
    displayName: context.displayName,
    bio: context.bio,
    followerCount: context.followerCount,
    followingCount: context.followingCount,
    following: context.followingPreview.map(serializePublicGraphProfile),
    followers: context.followerPreview.map(serializePublicGraphProfile),
  };
}
