import "server-only";

import { HttpError } from "@/lib/http-error";
import {
  AI_AGENT_LIMITS,
  isAiActionType,
  isAiSourceType,
  isUuid,
  truncateText,
  unicodeLength,
  type AiActionType,
  type AiSourceType,
} from "@/lib/ai/policy";

export type AgentRequest = {
  message: string;
};

export type AgentSource = {
  type: AiSourceType;
  id: string;
  name: string;
};

export type AgentSuggestion = {
  type: AiSourceType;
  id: string;
  reason: string;
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
  sources: AgentSource[];
  suggestions: AgentSuggestion[];
  actions: AgentAction[];
};

export type EvidenceIndex = {
  users: Map<string, string>;
  communities: Map<string, string>;
  posts: Map<string, string>;
};

export function parseAgentRequest(input: unknown): AgentRequest {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object.");
  }
  const record = input as Record<string, unknown>;
  if (typeof record.message !== "string") {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      message: "message is required.",
    });
  }
  const message = record.message.trim();
  const length = unicodeLength(message);
  if (length < AI_AGENT_LIMITS.minMessageLength) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      message: "message must not be blank.",
    });
  }
  if (length > AI_AGENT_LIMITS.maxMessageLength) {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      message: `message must be at most ${AI_AGENT_LIMITS.maxMessageLength} characters.`,
    });
  }
  return { message };
}

export function emptyEvidence(): EvidenceIndex {
  return {
    users: new Map(),
    communities: new Map(),
    posts: new Map(),
  };
}

export function evidenceHas(
  evidence: EvidenceIndex,
  type: AiSourceType,
  id: string,
): boolean {
  if (type === "user") {
    return evidence.users.has(id);
  }
  if (type === "community") {
    return evidence.communities.has(id);
  }
  return evidence.posts.has(id);
}

export function evidenceName(
  evidence: EvidenceIndex,
  type: AiSourceType,
  id: string,
): string | undefined {
  if (type === "user") {
    return evidence.users.get(id);
  }
  if (type === "community") {
    return evidence.communities.get(id);
  }
  return evidence.posts.get(id);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseSuggestion(
  value: unknown,
  evidence: EvidenceIndex,
): AgentSuggestion | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isAiSourceType(record.type) || !isUuid(record.id)) {
    return null;
  }
  if (!evidenceHas(evidence, record.type, record.id)) {
    return null;
  }
  const reason = truncateText(
    (readString(record.reason) ?? "").trim(),
    AI_AGENT_LIMITS.maxSuggestionReasonLength,
  );
  if (reason.length === 0) {
    return null;
  }
  return { type: record.type, id: record.id, reason };
}

function parseAction(value: unknown, evidence: EvidenceIndex): AgentAction | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isAiActionType(record.type)) {
    return null;
  }
  const type: AiActionType = record.type;
  if (type === "DRAFT_POST") {
    const draft = truncateText(
      (readString(record.draft) ?? "").trim(),
      AI_AGENT_LIMITS.maxDraftLength,
    );
    if (draft.length === 0) {
      return null;
    }
    return { type, draft, requiresConfirmation: true };
  }
  if (!isUuid(record.targetId)) {
    return null;
  }
  if (type === "FOLLOW_USER" && !evidence.users.has(record.targetId)) {
    return null;
  }
  if (type === "JOIN_COMMUNITY" && !evidence.communities.has(record.targetId)) {
    return null;
  }
  if (type === "DRAFT_MESSAGE" && !evidence.users.has(record.targetId)) {
    return null;
  }
  if (type === "DRAFT_MESSAGE") {
    const draft = truncateText(
      (readString(record.draft) ?? "").trim(),
      AI_AGENT_LIMITS.maxDraftLength,
    );
    if (draft.length === 0) {
      return null;
    }
    return {
      type,
      targetId: record.targetId,
      draft,
      requiresConfirmation: true,
    };
  }
  return {
    type,
    targetId: record.targetId,
    requiresConfirmation: true,
  };
}

export function sourcesFromEvidence(evidence: EvidenceIndex): AgentSource[] {
  const sources: AgentSource[] = [];
  for (const [id, name] of evidence.users) {
    sources.push({
      type: "user",
      id,
      name: truncateText(name, AI_AGENT_LIMITS.maxSourceNameLength),
    });
    if (sources.length >= AI_AGENT_LIMITS.maxSources) {
      return sources;
    }
  }
  for (const [id, name] of evidence.communities) {
    sources.push({
      type: "community",
      id,
      name: truncateText(name, AI_AGENT_LIMITS.maxSourceNameLength),
    });
    if (sources.length >= AI_AGENT_LIMITS.maxSources) {
      return sources;
    }
  }
  for (const [id, name] of evidence.posts) {
    sources.push({
      type: "post",
      id,
      name: truncateText(name, AI_AGENT_LIMITS.maxSourceNameLength),
    });
    if (sources.length >= AI_AGENT_LIMITS.maxSources) {
      return sources;
    }
  }
  return sources;
}

export function normalizeAgentOutput(
  raw: unknown,
  evidence: EvidenceIndex,
): AgentResponse {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(503, "ai_unavailable", "AI is unavailable.");
  }
  const record = raw as Record<string, unknown>;
  const messageRaw = readString(record.message);
  if (messageRaw === null) {
    throw new HttpError(503, "ai_unavailable", "AI is unavailable.");
  }
  const message = truncateText(messageRaw.trim(), AI_AGENT_LIMITS.maxOutputMessageLength);
  if (message.length === 0) {
    throw new HttpError(503, "ai_unavailable", "AI is unavailable.");
  }

  const suggestions: AgentSuggestion[] = [];
  if (Array.isArray(record.suggestions)) {
    for (const entry of record.suggestions) {
      const parsed = parseSuggestion(entry, evidence);
      if (parsed) {
        suggestions.push(parsed);
      }
      if (suggestions.length >= AI_AGENT_LIMITS.maxSuggestions) {
        break;
      }
    }
  }

  const actions: AgentAction[] = [];
  if (Array.isArray(record.actions)) {
    for (const entry of record.actions) {
      const parsed = parseAction(entry, evidence);
      if (parsed) {
        actions.push(parsed);
      }
      if (actions.length >= AI_AGENT_LIMITS.maxActions) {
        break;
      }
    }
  }

  const sources = sourcesFromEvidence(evidence);
  const evidenceEmpty =
    evidence.users.size === 0 &&
    evidence.communities.size === 0 &&
    evidence.posts.size === 0;

  return {
    message: evidenceEmpty
      ? "I did not find matching people, communities, or posts for that request."
      : message,
    sources,
    suggestions: evidenceEmpty ? [] : suggestions,
    actions: evidenceEmpty ? [] : actions,
  };
}

export function serializeAgentResponse(response: AgentResponse) {
  return {
    message: response.message,
    sources: response.sources.map((source) => ({
      type: source.type,
      id: source.id,
      name: source.name,
    })),
    suggestions: response.suggestions.map((suggestion) => ({
      type: suggestion.type,
      id: suggestion.id,
      reason: suggestion.reason,
    })),
    actions: response.actions.map((action) => {
      if (action.type === "DRAFT_POST") {
        return {
          type: action.type,
          draft: action.draft,
          requiresConfirmation: true as const,
        };
      }
      if (action.type === "DRAFT_MESSAGE") {
        return {
          type: action.type,
          targetId: action.targetId,
          draft: action.draft,
          requiresConfirmation: true as const,
        };
      }
      return {
        type: action.type,
        targetId: action.targetId,
        requiresConfirmation: true as const,
      };
    }),
  };
}
