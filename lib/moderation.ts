import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import { requireActiveUser, type PublicUser } from "@/lib/auth";
import { assertTrustedModerator } from "@/lib/authorization";
import { getCommunity } from "@/lib/communities";
import { unicodeLength } from "@/lib/content";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { HttpError } from "@/lib/http-error";
import { createDisabledModerationAbuseLimiter } from "@/lib/moderation-abuse";
import {
  isEnforcementActionType,
  isReportReason,
  isReportStatus,
  isReportTargetType,
  moderationLimits,
  type EnforcementActionType,
  type ModerationActionType,
  type ReportReason,
  type ReportStatus,
  type ReportTargetType,
} from "@/lib/moderation-policy";
import {
  decodeCursor,
  encodeCursor,
  type PageParams,
  type PageResult,
} from "@/lib/pagination";
import { getPost } from "@/lib/posts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const moderationAbuseLimiter = createDisabledModerationAbuseLimiter();

type ReportRow = {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  explanation: string | null;
  status: ReportStatus;
  assignedModeratorId: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};

type ActionRow = {
  id: string;
  actionType: ModerationActionType;
  targetType: ReportTargetType;
  targetId: string;
  reportId: string | null;
  reason: string;
  outcome: string;
  createdAt: Date;
};

export type PublicTargetSummary = {
  type: ReportTargetType;
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
};

export type PublicReporterReport = {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  target: PublicTargetSummary | null;
  reason: ReportReason;
  explanation: string | null;
  status: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};

export type PublicModerationAction = {
  id: string;
  actionType: ModerationActionType;
  targetType: ReportTargetType;
  targetId: string;
  reportId: string | null;
  reason: string;
  outcome: string;
  createdAt: Date;
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

export type PublicReportedMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  deleted: boolean;
  body: string | null;
};

export type QueueFilters = {
  status?: ReportStatus;
  targetType?: ReportTargetType;
  reason?: ReportReason;
  from?: Date;
  to?: Date;
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

function notFound(message = "Not found."): HttpError {
  return new HttpError(404, "not_found", message);
}

function conflict(message: string): HttpError {
  return new HttpError(409, "conflict", message);
}

function ownTargetError(): HttpError {
  return new HttpError(400, "invalid_input", "Invalid input.", {
    targetId: "You cannot report your own account or content.",
  });
}

function activeDedupeKey(targetType: ReportTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
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

async function isBlockedBetween(
  firstId: string,
  secondId: string,
): Promise<boolean> {
  const prisma = getPrismaClient();
  const [blocked, blockedBy] = await Promise.all([
    prisma.block.findUnique({
      where: {
        blockerId_blockedId: { blockerId: firstId, blockedId: secondId },
      },
      select: { id: true },
    }),
    prisma.block.findUnique({
      where: {
        blockerId_blockedId: { blockerId: secondId, blockedId: firstId },
      },
      select: { id: true },
    }),
  ]);
  return Boolean(blocked) || Boolean(blockedBy);
}

async function loadModeratorFlag(userId: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { isModerator: true },
  });
  return Boolean(row?.isModerator);
}

export async function requireModerator(
  sessionToken: string | undefined,
): Promise<PublicUser> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const isModerator = await loadModeratorFlag(actor.id);
  assertTrustedModerator(isModerator);
  return actor;
}

function toPublicAction(row: ActionRow): PublicModerationAction {
  return {
    id: row.id,
    actionType: row.actionType,
    targetType: row.targetType,
    targetId: row.targetId,
    reportId: row.reportId,
    reason: row.reason,
    outcome: row.outcome,
    createdAt: row.createdAt,
  };
}

export function serializePublicReporterReport(report: PublicReporterReport) {
  return {
    id: report.id,
    targetType: report.targetType,
    targetId: report.targetId,
    target: report.target,
    reason: report.reason,
    explanation: report.explanation,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    resolvedAt: report.resolvedAt ? report.resolvedAt.toISOString() : null,
  };
}

export function serializePublicModeratorReport(report: PublicModeratorReport) {
  return {
    ...serializePublicReporterReport(report),
    reporter: report.reporter,
    assignedModeratorId: report.assignedModeratorId,
    resolutionNote: report.resolutionNote,
    actions: report.actions.map((action) => ({
      id: action.id,
      actionType: action.actionType,
      targetType: action.targetType,
      targetId: action.targetId,
      reportId: action.reportId,
      reason: action.reason,
      outcome: action.outcome,
      createdAt: action.createdAt.toISOString(),
    })),
  };
}

export function serializePublicReportedMessage(message: PublicReportedMessage) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    deleted: message.deleted,
    body: message.body,
  };
}

export function assertBoundedRequestSize(rawBody: string): void {
  if (Buffer.byteLength(rawBody, "utf8") > moderationLimits.maxRequestBytes) {
    throw new HttpError(413, "payload_too_large", "Request is too large.", {
      message: `Request body must be at most ${moderationLimits.maxRequestBytes} bytes.`,
    });
  }
}

function readOptionalExplanation(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      explanation: "explanation must be a string.",
    });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (unicodeLength(trimmed) > moderationLimits.explanationMaxLength) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      explanation: `explanation must be at most ${moderationLimits.explanationMaxLength} characters.`,
    });
  }
  return trimmed;
}

function readRequiredNote(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      [field]: `${field} is required.`,
    });
  }
  const trimmed = value.trim();
  if (unicodeLength(trimmed) > moderationLimits.reasonNoteMaxLength) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      [field]: `${field} must be at most ${moderationLimits.reasonNoteMaxLength} characters.`,
    });
  }
  return trimmed;
}

async function assertReportableTarget(
  sessionToken: string | undefined,
  actorId: string,
  targetType: ReportTargetType,
  targetId: string,
): Promise<void> {
  const prisma = getPrismaClient();
  switch (targetType) {
    case "USER": {
      const user = await prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, status: true, deletedAt: true },
      });
      if (!user || user.status === "DELETED" || user.deletedAt) {
        throw notFound("User not found.");
      }
      if (user.id === actorId) {
        throw ownTargetError();
      }
      const blockedBy = await prisma.block.findUnique({
        where: {
          blockerId_blockedId: { blockerId: targetId, blockedId: actorId },
        },
        select: { id: true },
      });
      if (blockedBy) {
        throw notFound("User not found.");
      }
      return;
    }
    case "POST": {
      const post = await getPost(sessionToken, targetId);
      if (post.author.userId === actorId) {
        throw ownTargetError();
      }
      return;
    }
    case "COMMENT": {
      const comment = await prisma.comment.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          postId: true,
          authorId: true,
          deletedAt: true,
          hiddenAt: true,
        },
      });
      if (!comment || comment.deletedAt || comment.hiddenAt) {
        throw notFound("Comment not found.");
      }
      if (comment.authorId === actorId) {
        throw ownTargetError();
      }
      await getPost(sessionToken, comment.postId);
      return;
    }
    case "MESSAGE": {
      const message = await prisma.message.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          senderId: true,
          deletedAt: true,
          conversation: {
            select: { participants: { select: { userId: true } } },
          },
        },
      });
      if (!message || message.deletedAt) {
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
      if (message.senderId === actorId) {
        throw ownTargetError();
      }
      return;
    }
    case "COMMUNITY": {
      const community = await getCommunity(sessionToken, targetId);
      if (community.owner?.userId === actorId) {
        throw ownTargetError();
      }
      return;
    }
    default:
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        targetType: "Unsupported target type.",
      });
  }
}

async function loadTargetSummary(
  sessionToken: string | undefined,
  viewerId: string,
  targetType: ReportTargetType,
  targetId: string,
  asModerator: boolean,
): Promise<PublicTargetSummary | null> {
  const prisma = getPrismaClient();
  switch (targetType) {
    case "USER": {
      const user = await prisma.user.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          status: true,
          deletedAt: true,
          profile: { select: { username: true, displayName: true } },
        },
      });
      if (!user || user.status === "DELETED" || user.deletedAt) {
        return {
          type: "USER",
          id: targetId,
          visible: false,
          deleted: true,
        };
      }
      if (!asModerator) {
        const blockedBy = await prisma.block.findUnique({
          where: {
            blockerId_blockedId: { blockerId: targetId, blockedId: viewerId },
          },
          select: { id: true },
        });
        if (blockedBy) {
          return { type: "USER", id: targetId, visible: false };
        }
      }
      return {
        type: "USER",
        id: targetId,
        visible: true,
        userId: user.id,
        username: user.profile?.username ?? null,
        displayName: user.profile?.displayName ?? null,
      };
    }
    case "POST": {
      const post = await prisma.post.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          authorId: true,
          deletedAt: true,
          hiddenAt: true,
        },
      });
      if (!post) {
        return { type: "POST", id: targetId, visible: false };
      }
      if (asModerator) {
        return {
          type: "POST",
          id: post.id,
          visible: !post.deletedAt,
          userId: post.authorId,
          hidden: Boolean(post.hiddenAt),
          deleted: Boolean(post.deletedAt),
        };
      }
      try {
        const visible = await getPost(sessionToken, targetId);
        return {
          type: "POST",
          id: visible.id,
          visible: true,
          userId: visible.author.userId,
          hidden: false,
          deleted: false,
        };
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          return { type: "POST", id: targetId, visible: false };
        }
        throw error;
      }
    }
    case "COMMENT": {
      const comment = await prisma.comment.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          postId: true,
          authorId: true,
          deletedAt: true,
          hiddenAt: true,
        },
      });
      if (!comment) {
        return { type: "COMMENT", id: targetId, visible: false };
      }
      if (asModerator) {
        return {
          type: "COMMENT",
          id: comment.id,
          visible: !comment.deletedAt,
          userId: comment.authorId,
          postId: comment.postId,
          hidden: Boolean(comment.hiddenAt),
          deleted: Boolean(comment.deletedAt),
        };
      }
      if (comment.deletedAt || comment.hiddenAt) {
        return { type: "COMMENT", id: targetId, visible: false };
      }
      try {
        await getPost(sessionToken, comment.postId);
        return {
          type: "COMMENT",
          id: comment.id,
          visible: true,
          userId: comment.authorId,
          postId: comment.postId,
          hidden: false,
          deleted: false,
        };
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          return { type: "COMMENT", id: targetId, visible: false };
        }
        throw error;
      }
    }
    case "MESSAGE": {
      const message = await prisma.message.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          deletedAt: true,
        },
      });
      if (!message) {
        return { type: "MESSAGE", id: targetId, visible: false };
      }
      return {
        type: "MESSAGE",
        id: message.id,
        visible: true,
        userId: message.senderId,
        conversationId: message.conversationId,
        deleted: Boolean(message.deletedAt),
      };
    }
    case "COMMUNITY": {
      if (asModerator) {
        const community = await prisma.community.findUnique({
          where: { id: targetId },
          select: { id: true, name: true, deletedAt: true },
        });
        if (!community) {
          return { type: "COMMUNITY", id: targetId, visible: false };
        }
        return {
          type: "COMMUNITY",
          id: community.id,
          visible: !community.deletedAt,
          communityName: community.name,
          deleted: Boolean(community.deletedAt),
        };
      }
      try {
        const community = await getCommunity(sessionToken, targetId);
        return {
          type: "COMMUNITY",
          id: community.id,
          visible: true,
          communityName: community.name,
        };
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          return { type: "COMMUNITY", id: targetId, visible: false };
        }
        throw error;
      }
    }
    default:
      return null;
  }
}

async function toReporterReport(
  sessionToken: string | undefined,
  viewerId: string,
  row: ReportRow,
): Promise<PublicReporterReport> {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    target: await loadTargetSummary(
      sessionToken,
      viewerId,
      row.targetType,
      row.targetId,
      false,
    ),
    reason: row.reason,
    explanation: row.explanation,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
  };
}

async function toModeratorReport(
  sessionToken: string | undefined,
  viewerId: string,
  row: ReportRow,
  actions: ActionRow[] = [],
): Promise<PublicModeratorReport> {
  const prisma = getPrismaClient();
  const reporter = await prisma.user.findUnique({
    where: { id: row.reporterId },
    select: {
      id: true,
      status: true,
      deletedAt: true,
      profile: { select: { username: true, displayName: true } },
    },
  });
  const reporterDto =
    reporter &&
    reporter.status !== "DELETED" &&
    !reporter.deletedAt &&
    reporter.profile
      ? {
          userId: reporter.id,
          username: reporter.profile.username,
          displayName: reporter.profile.displayName,
        }
      : null;
  const base = await toReporterReport(sessionToken, viewerId, row);
  base.target = await loadTargetSummary(
    sessionToken,
    viewerId,
    row.targetType,
    row.targetId,
    true,
  );
  return {
    ...base,
    reporter: reporterDto,
    assignedModeratorId: row.assignedModeratorId,
    resolutionNote: row.resolutionNote,
    actions: actions.map(toPublicAction),
  };
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  input: {
    moderatorId: string;
    actionType: ModerationActionType;
    targetType: ReportTargetType;
    targetId: string;
    reportId?: string | null;
    reason: string;
    outcome: string;
  },
): Promise<ActionRow> {
  return tx.moderationAction.create({
    data: {
      moderatorId: input.moderatorId,
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
      reportId: input.reportId ?? null,
      reason: input.reason,
      outcome: input.outcome,
    },
    select: {
      id: true,
      actionType: true,
      targetType: true,
      targetId: true,
      reportId: true,
      reason: true,
      outcome: true,
      createdAt: true,
    },
  });
}

export async function createReport(
  sessionToken: string | undefined,
  input: {
    targetType: unknown;
    targetId: unknown;
    reason: unknown;
    explanation?: unknown;
  },
): Promise<PublicReporterReport> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  moderationAbuseLimiter.check(`report:${actor.id}`);
  if (!isReportTargetType(input.targetType)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      targetType: "A supported targetType is required.",
    });
  }
  if (typeof input.targetId !== "string" || !UUID_PATTERN.test(input.targetId)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      targetId: "A valid targetId is required.",
    });
  }
  if (!isReportReason(input.reason)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      reason: "A supported reason is required.",
    });
  }
  const explanation = readOptionalExplanation(input.explanation);
  await assertReportableTarget(
    sessionToken,
    actor.id,
    input.targetType,
    input.targetId,
  );

  const prisma = getPrismaClient();
  try {
    const created = await prisma.report.create({
      data: {
        reporterId: actor.id,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        explanation,
        status: "OPEN",
        activeDedupeKey: activeDedupeKey(input.targetType, input.targetId),
      },
    });
    return toReporterReport(sessionToken, actor.id, created);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw conflict("You already have an active report for this target.");
    }
    throw error;
  }
}

export async function listMyReports(
  sessionToken: string | undefined,
  params: PageParams,
): Promise<PageResult<PublicReporterReport>> {
  requireDatabaseConfigured();
  const actor = await requireActiveUser(sessionToken);
  const prisma = getPrismaClient();
  const rows = await prisma.report.findMany({
    where: {
      reporterId: actor.id,
      ...cursorWhereDesc(params.cursor),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.limit + 1,
  });
  const page = await Promise.all(
    rows
      .slice(0, params.limit)
      .map((row) => toReporterReport(sessionToken, actor.id, row)),
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

export async function getMyReport(
  sessionToken: string | undefined,
  reportId: string,
): Promise<PublicReporterReport> {
  requireDatabaseConfigured();
  assertId(reportId, "report id");
  const actor = await requireActiveUser(sessionToken);
  const prisma = getPrismaClient();
  const row = await prisma.report.findUnique({ where: { id: reportId } });
  if (!row || row.reporterId !== actor.id) {
    throw notFound("Report not found.");
  }
  return toReporterReport(sessionToken, actor.id, row);
}

export function parseQueueFilters(searchParams: URLSearchParams): QueueFilters {
  const filters: QueueFilters = {};
  const status = searchParams.get("status");
  if (status !== null) {
    if (!isReportStatus(status)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        status: "status filter is invalid.",
      });
    }
    filters.status = status;
  }
  const targetType = searchParams.get("targetType");
  if (targetType !== null) {
    if (!isReportTargetType(targetType)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        targetType: "targetType filter is invalid.",
      });
    }
    filters.targetType = targetType;
  }
  const reason = searchParams.get("reason");
  if (reason !== null) {
    if (!isReportReason(reason)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        reason: "reason filter is invalid.",
      });
    }
    filters.reason = reason;
  }
  const from = searchParams.get("from");
  if (from !== null) {
    const parsed = new Date(from);
    if (Number.isNaN(parsed.getTime())) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        from: "from must be an ISO-8601 timestamp.",
      });
    }
    filters.from = parsed;
  }
  const to = searchParams.get("to");
  if (to !== null) {
    const parsed = new Date(to);
    if (Number.isNaN(parsed.getTime())) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        to: "to must be an ISO-8601 timestamp.",
      });
    }
    filters.to = parsed;
  }
  return filters;
}

export async function listModerationQueue(
  sessionToken: string | undefined,
  params: PageParams,
  filters: QueueFilters,
): Promise<PageResult<PublicModeratorReport>> {
  const actor = await requireModerator(sessionToken);
  const prisma = getPrismaClient();
  const createdAt =
    filters.from || filters.to
      ? {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        }
      : undefined;
  const rows = await prisma.report.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.targetType ? { targetType: filters.targetType } : {}),
      ...(filters.reason ? { reason: filters.reason } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...cursorWhereDesc(params.cursor),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.limit + 1,
  });
  const page = await Promise.all(
    rows
      .slice(0, params.limit)
      .map((row) => toModeratorReport(sessionToken, actor.id, row)),
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

async function loadReportOr404(reportId: string): Promise<ReportRow> {
  assertId(reportId, "report id");
  const prisma = getPrismaClient();
  const row = await prisma.report.findUnique({ where: { id: reportId } });
  if (!row) {
    throw notFound("Report not found.");
  }
  return row;
}

export async function getModerationReport(
  sessionToken: string | undefined,
  reportId: string,
): Promise<PublicModeratorReport> {
  const actor = await requireModerator(sessionToken);
  const row = await loadReportOr404(reportId);
  const prisma = getPrismaClient();
  const actions = await prisma.moderationAction.findMany({
    where: { reportId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return toModeratorReport(sessionToken, actor.id, row, actions);
}

export async function claimReport(
  sessionToken: string | undefined,
  reportId: string,
): Promise<PublicModeratorReport> {
  const actor = await requireModerator(sessionToken);
  const existing = await loadReportOr404(reportId);
  if (
    existing.status === "UNDER_REVIEW" &&
    existing.assignedModeratorId === actor.id
  ) {
    return getModerationReport(sessionToken, reportId);
  }
  if (existing.status !== "OPEN") {
    throw conflict("This report cannot be claimed.");
  }
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.report.updateMany({
      where: { id: reportId, status: "OPEN" },
      data: {
        status: "UNDER_REVIEW",
        assignedModeratorId: actor.id,
      },
    });
    if (updated.count !== 1) {
      throw conflict("This report cannot be claimed.");
    }
    await writeAudit(tx, {
      moderatorId: actor.id,
      actionType: "CLAIM_REPORT",
      targetType: existing.targetType,
      targetId: existing.targetId,
      reportId,
      reason: "Claimed for review.",
      outcome: "UNDER_REVIEW",
    });
  });
  return getModerationReport(sessionToken, reportId);
}

export async function assignReport(
  sessionToken: string | undefined,
  reportId: string,
  input: { moderatorId: unknown },
): Promise<PublicModeratorReport> {
  const actor = await requireModerator(sessionToken);
  const existing = await loadReportOr404(reportId);
  if (existing.status === "RESOLVED" || existing.status === "DISMISSED") {
    throw conflict("Resolved reports cannot be reassigned.");
  }
  if (
    typeof input.moderatorId !== "string" ||
    !UUID_PATTERN.test(input.moderatorId)
  ) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      moderatorId: "A valid moderatorId is required.",
    });
  }
  const prisma = getPrismaClient();
  const assignee = await prisma.user.findUnique({
    where: { id: input.moderatorId },
    select: { id: true, status: true, deletedAt: true, isModerator: true },
  });
  if (
    !assignee ||
    assignee.status !== "ACTIVE" ||
    assignee.deletedAt ||
    !assignee.isModerator
  ) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      moderatorId: "Assignee must be an active moderator.",
    });
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.report.updateMany({
      where: {
        id: reportId,
        status: { in: ["OPEN", "UNDER_REVIEW"] },
      },
      data: {
        status: "UNDER_REVIEW",
        assignedModeratorId: assignee.id,
      },
    });
    if (updated.count !== 1) {
      throw conflict("This report cannot be assigned.");
    }
    await writeAudit(tx, {
      moderatorId: actor.id,
      actionType: "ASSIGN_REPORT",
      targetType: existing.targetType,
      targetId: existing.targetId,
      reportId,
      reason: "Assigned for review.",
      outcome: "UNDER_REVIEW",
    });
  });
  return getModerationReport(sessionToken, reportId);
}

async function closeReport(
  sessionToken: string | undefined,
  reportId: string,
  nextStatus: "RESOLVED" | "DISMISSED",
  reason: unknown,
): Promise<PublicModeratorReport> {
  const actor = await requireModerator(sessionToken);
  const existing = await loadReportOr404(reportId);
  if (existing.status !== "UNDER_REVIEW") {
    throw conflict("Only reports under review can be closed.");
  }
  const note = readRequiredNote(reason, "reason");
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.report.updateMany({
      where: { id: reportId, status: "UNDER_REVIEW" },
      data: {
        status: nextStatus,
        resolutionNote: note,
        resolvedAt: new Date(),
        activeDedupeKey: null,
      },
    });
    if (updated.count !== 1) {
      throw conflict("This report cannot be closed.");
    }
    await writeAudit(tx, {
      moderatorId: actor.id,
      actionType: nextStatus === "RESOLVED" ? "RESOLVE_REPORT" : "DISMISS_REPORT",
      targetType: existing.targetType,
      targetId: existing.targetId,
      reportId,
      reason: note,
      outcome: nextStatus,
    });
  });
  return getModerationReport(sessionToken, reportId);
}

export async function resolveReport(
  sessionToken: string | undefined,
  reportId: string,
  input: { reason: unknown },
): Promise<PublicModeratorReport> {
  return closeReport(sessionToken, reportId, "RESOLVED", input.reason);
}

export async function dismissReport(
  sessionToken: string | undefined,
  reportId: string,
  input: { reason: unknown },
): Promise<PublicModeratorReport> {
  return closeReport(sessionToken, reportId, "DISMISSED", input.reason);
}

export async function viewReportedMessage(
  sessionToken: string | undefined,
  reportId: string,
): Promise<PublicReportedMessage> {
  const actor = await requireModerator(sessionToken);
  const report = await loadReportOr404(reportId);
  if (report.targetType !== "MESSAGE") {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      reportId: "This report does not target a private message.",
    });
  }
  const prisma = getPrismaClient();
  const message = await prisma.message.findUnique({
    where: { id: report.targetId },
    select: {
      id: true,
      conversationId: true,
      senderId: true,
      body: true,
      deletedAt: true,
    },
  });
  if (!message) {
    throw notFound("Message not found.");
  }
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      moderatorId: actor.id,
      actionType: "VIEW_PRIVATE_MESSAGE",
      targetType: "MESSAGE",
      targetId: message.id,
      reportId,
      reason: "Reviewed reported private message.",
      outcome: "viewed",
    });
  });
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    deleted: Boolean(message.deletedAt),
    body: message.deletedAt ? null : message.body,
  };
}

async function loadOptionalReport(
  reportId: string | null,
): Promise<ReportRow | null> {
  if (!reportId) {
    return null;
  }
  return loadReportOr404(reportId);
}

async function hideOrRestoreContent(
  tx: Prisma.TransactionClient,
  actionType: "HIDE_CONTENT" | "RESTORE_CONTENT",
  targetType: ReportTargetType,
  targetId: string,
): Promise<string> {
  if (targetType !== "POST" && targetType !== "COMMENT") {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      targetType: "Content actions apply only to POST or COMMENT.",
    });
  }
  if (targetType === "POST") {
    const post = await tx.post.findUnique({
      where: { id: targetId },
      select: { id: true, deletedAt: true, hiddenAt: true },
    });
    if (!post) {
      throw notFound("Post not found.");
    }
    if (actionType === "HIDE_CONTENT") {
      if (!post.hiddenAt) {
        await tx.post.update({
          where: { id: targetId },
          data: { hiddenAt: new Date() },
        });
      }
      return post.deletedAt ? "hidden_owner_deleted" : "hidden";
    }
    if (post.hiddenAt) {
      await tx.post.update({
        where: { id: targetId },
        data: { hiddenAt: null },
      });
    }
    return post.deletedAt ? "owner_deleted" : "visible";
  }
  const comment = await tx.comment.findUnique({
    where: { id: targetId },
    select: { id: true, deletedAt: true, hiddenAt: true },
  });
  if (!comment) {
    throw notFound("Comment not found.");
  }
  if (actionType === "HIDE_CONTENT") {
    if (!comment.hiddenAt) {
      await tx.comment.update({
        where: { id: targetId },
        data: { hiddenAt: new Date() },
      });
    }
    return comment.deletedAt ? "hidden_owner_deleted" : "hidden";
  }
  if (comment.hiddenAt) {
    await tx.comment.update({
      where: { id: targetId },
      data: { hiddenAt: null },
    });
  }
  return comment.deletedAt ? "owner_deleted" : "visible";
}

async function applyUserEnforcement(
  tx: Prisma.TransactionClient,
  actorId: string,
  actionType: "WARN_USER" | "SUSPEND_USER" | "UNSUSPEND_USER",
  targetId: string,
): Promise<string> {
  const user = await tx.user.findUnique({
    where: { id: targetId },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!user || user.status === "DELETED" || user.deletedAt) {
    throw notFound("User not found.");
  }
  if (actionType === "WARN_USER") {
    return "warned";
  }
  if (actionType === "SUSPEND_USER") {
    if (targetId === actorId) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        targetId: "Moderators cannot suspend themselves.",
      });
    }
    if (user.status !== "SUSPENDED") {
      await tx.user.update({
        where: { id: targetId },
        data: { status: "SUSPENDED" },
      });
      await tx.session.deleteMany({ where: { userId: targetId } });
    }
    return "SUSPENDED";
  }
  if (user.status !== "SUSPENDED") {
    throw conflict("Only suspended accounts can be unsuspended.");
  }
  await tx.user.update({
    where: { id: targetId },
    data: { status: "ACTIVE" },
  });
  return "ACTIVE";
}

export async function applyEnforcement(
  sessionToken: string | undefined,
  input: {
    actionType: unknown;
    targetType: unknown;
    targetId: unknown;
    reason: unknown;
    reportId?: unknown;
  },
): Promise<PublicModerationAction> {
  const actor = await requireModerator(sessionToken);
  if (!isEnforcementActionType(input.actionType)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      actionType: "A supported enforcement actionType is required.",
    });
  }
  if (!isReportTargetType(input.targetType)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      targetType: "A supported targetType is required.",
    });
  }
  if (typeof input.targetId !== "string" || !UUID_PATTERN.test(input.targetId)) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      targetId: "A valid targetId is required.",
    });
  }
  const reason = readRequiredNote(input.reason, "reason");
  let reportId: string | null = null;
  if (input.reportId !== undefined && input.reportId !== null) {
    if (typeof input.reportId !== "string" || !UUID_PATTERN.test(input.reportId)) {
      throw new HttpError(400, "invalid_input", "Invalid input.", {
        reportId: "A valid reportId is required.",
      });
    }
    reportId = input.reportId;
  }
  await loadOptionalReport(reportId);

  const actionType = input.actionType as EnforcementActionType;
  const targetType = input.targetType;
  const targetId = input.targetId;
  if (
    (actionType === "WARN_USER" ||
      actionType === "SUSPEND_USER" ||
      actionType === "UNSUSPEND_USER") &&
    targetType !== "USER"
  ) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      targetType: "User actions require targetType USER.",
    });
  }

  const prisma = getPrismaClient();
  const action = await prisma.$transaction(async (tx) => {
    let outcome: string;
    if (actionType === "HIDE_CONTENT" || actionType === "RESTORE_CONTENT") {
      outcome = await hideOrRestoreContent(tx, actionType, targetType, targetId);
    } else {
      outcome = await applyUserEnforcement(
        tx,
        actor.id,
        actionType,
        targetId,
      );
    }
    return writeAudit(tx, {
      moderatorId: actor.id,
      actionType,
      targetType,
      targetId,
      reportId,
      reason,
      outcome,
    });
  });
  return toPublicAction(action);
}
