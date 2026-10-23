export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
};

export type PublicProfile = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  bio: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionUser = {
  id: string;
  email: string;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  isModerator: boolean;
  createdAt: string;
  updatedAt: string;
  profile: PublicProfile;
};

export type GraphProfile = {
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

export type PublicMedia = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  status: string;
  createdAt: string;
};

export type PublicPost = {
  id: string;
  channelId: string | null;
  author: GraphProfile;
  body: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  reactionCount: number;
  viewerHasLiked: boolean;
  media: PublicMedia[];
};

export type PublicComment = {
  id: string;
  postId: string;
  author: GraphProfile;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicCommunity = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  createdAt: string;
  updatedAt: string;
  owner: GraphProfile | null;
  memberCount: number;
  viewerRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  viewerIsMember: boolean;
};

export type PublicChannel = {
  id: string;
  communityId: string;
  name: string;
  slug: string;
  description: string | null;
  type: "TEXT" | "ANNOUNCEMENT";
  createdAt: string;
  updatedAt: string;
};

export type PublicCommunityMember = {
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  joinedAt: string;
  profile: GraphProfile | null;
};

export type PublicMessage = {
  id: string;
  conversationId: string;
  sender: GraphProfile;
  body: string | null;
  deleted: boolean;
  edited: boolean;
  createdAt: string;
  updatedAt: string;
  media: PublicMedia[];
};

export type PublicConversation = {
  id: string;
  createdAt: string;
  lastMessageAt: string;
  participants: GraphProfile[];
  otherParticipant: GraphProfile | null;
  unreadCount: number;
  lastMessage: PublicMessage | null;
};

export type PublicNotification = {
  id: string;
  type:
    | "FOLLOW"
    | "COMMENT"
    | "REACTION"
    | "MESSAGE"
    | "COMMUNITY_MEMBER_JOINED"
    | "COMMUNITY_ROLE_CHANGED";
  createdAt: string;
  readAt: string | null;
  actor: GraphProfile | null;
  target: {
    postId: string | null;
    commentId: string | null;
    conversationId: string | null;
    messageId: string | null;
    communityId: string | null;
  };
};

export type PublicReporterReport = {
  id: string;
  targetType: "USER" | "POST" | "COMMENT" | "MESSAGE" | "COMMUNITY";
  targetId: string;
  target: {
    type: "USER" | "POST" | "COMMENT" | "MESSAGE" | "COMMUNITY";
    id: string;
    visible: boolean;
    userId?: string;
    username?: string | null;
    displayName?: string | null;
    postId?: string;
    conversationId?: string;
    communityName?: string | null;
    hidden?: boolean;
    deleted?: boolean;
  } | null;
  reason: string;
  explanation: string | null;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "DISMISSED";
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type PublicModerationAction = {
  id: string;
  actionType: string;
  targetType: string;
  targetId: string;
  reportId: string | null;
  reason: string;
  outcome: string;
  createdAt: string;
};

export type PublicReportedMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  deleted: boolean;
  body: string | null;
};

export type PublicModeratorReport = PublicReporterReport & {
  reporter: {
    userId: string;
    username: string;
    displayName: string;
  } | null;
  assignedModeratorId: string | null;
  resolutionNote: string | null;
  actions: PublicModerationAction[];
};

export type AgentAction =
  | {
      type: "FOLLOW_USER" | "JOIN_COMMUNITY";
      targetId: string;
      requiresConfirmation: true;
    }
  | {
      type: "DRAFT_MESSAGE";
      targetId: string;
      draft: string;
      requiresConfirmation: true;
    }
  | {
      type: "DRAFT_POST";
      draft: string;
      requiresConfirmation: true;
    };

export type AgentResponse = {
  message: string;
  sources: Array<{ type: "user" | "community" | "post"; id: string; name: string }>;
  suggestions: Array<{
    type: "user" | "community" | "post";
    id: string;
    reason: string;
  }>;
  actions: AgentAction[];
};
