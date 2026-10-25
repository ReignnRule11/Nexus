import { describe, expect, it } from "vitest";
import {
  AI_ABUSE_PROTECTION_MODE,
  AI_ABUSE_PROTECTION_NOTE,
  AI_RATE_LIMITS,
} from "@/lib/ai-abuse";
import {
  AI_ACTION_TYPES,
  AI_AGENT_LIMITS,
  AI_SEMANTICS,
  AI_SYSTEM_INSTRUCTION,
  AI_TOOL_NAMES,
  isAiActionType,
  isAiToolName,
  isUuid,
  truncateText,
} from "@/lib/ai/policy";
import {
  emptyEvidence,
  normalizeAgentOutput,
  parseAgentRequest,
  serializeAgentResponse,
} from "@/lib/ai/schemas";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMMUNITY_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const FAKE_ID = "44444444-4444-4444-8444-444444444444";

describe("AI policy", () => {
  it("declares the read-only tool allowlist", () => {
    expect(AI_TOOL_NAMES).toEqual([
      "searchUsers",
      "searchCommunities",
      "searchPosts",
      "getAccessibleProfile",
      "getAccessibleCommunity",
      "getUserSocialContext",
    ]);
    expect(isAiToolName("searchUsers")).toBe(true);
    expect(isAiToolName("executeSql")).toBe(false);
    expect(isAiToolName("followUser")).toBe(false);
  });

  it("keeps actions as confirmation-required proposals", () => {
    expect(AI_ACTION_TYPES).toEqual([
      "FOLLOW_USER",
      "JOIN_COMMUNITY",
      "DRAFT_MESSAGE",
      "DRAFT_POST",
    ]);
    expect(isAiActionType("FOLLOW_USER")).toBe(true);
    expect(isAiActionType("SEND_MESSAGE")).toBe(false);
    expect(AI_SEMANTICS.actions).toContain("proposals");
    expect(AI_SEMANTICS.actions).toContain("requiresConfirmation");
  });

  it("documents architectural prompt-injection and privacy boundaries", () => {
    expect(AI_SYSTEM_INSTRUCTION).toContain("untrusted");
    expect(AI_SYSTEM_INSTRUCTION).toContain("Never fabricate");
    expect(AI_SYSTEM_INSTRUCTION).toContain("file reports");
    expect(AI_SEMANTICS.authorization).toContain("not an authorization layer");
    expect(AI_SEMANTICS.privacy).toContain("emails");
    expect(AI_SEMANTICS.ranking).toContain("not ML");
    expect(AI_SEMANTICS.conversation).toContain("not stored");
  });

  it("bounds request, tool, and output sizes", () => {
    expect(AI_AGENT_LIMITS.maxMessageLength).toBe(2000);
    expect(AI_AGENT_LIMITS.maxToolCallsPerRequest).toBe(4);
    expect(AI_AGENT_LIMITS.maxToolResultsPerCall).toBe(5);
    expect(AI_AGENT_LIMITS.maxContextItems).toBe(12);
    expect(truncateText("abcdef", 3)).toBe("abc");
    expect(isUuid(USER_ID)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("documents PostgreSQL AI rate limiting", () => {
    expect(AI_ABUSE_PROTECTION_MODE).toBe("postgres");
    expect(AI_ABUSE_PROTECTION_NOTE).toMatch(/PostgreSQL fixed-window limiter/i);
    expect(AI_ABUSE_PROTECTION_NOTE).toMatch(/fails closed/i);
    expect(AI_RATE_LIMITS.agent.limit).toBeGreaterThan(0);
    expect(AI_RATE_LIMITS.agent.windowMs).toBe(60 * 60 * 1000);
  });
});

describe("AI schemas", () => {
  it("rejects blank, oversized, and non-object requests", () => {
    expect(() => parseAgentRequest({ message: "   " })).toThrow(/Invalid input/);
    expect(() =>
      parseAgentRequest({ message: "x".repeat(AI_AGENT_LIMITS.maxMessageLength + 1) }),
    ).toThrow(/Invalid input/);
    expect(() => parseAgentRequest([])).toThrow(/JSON object/);
  });

  it("accepts a bounded user message", () => {
    expect(parseAgentRequest({ message: "  Find backend developers.  " })).toEqual({
      message: "Find backend developers.",
    });
  });

  it("drops fabricated ids and forces confirmation on actions", () => {
    const evidence = emptyEvidence();
    evidence.users.set(USER_ID, "Ada");
    evidence.communities.set(COMMUNITY_ID, "Builders");
    evidence.posts.set(POST_ID, "hello react");

    const normalized = normalizeAgentOutput(
      {
        message: "Here are people and communities.",
        suggestions: [
          { type: "user", id: USER_ID, reason: "Matches backend" },
          { type: "user", id: FAKE_ID, reason: "Invented" },
          { type: "community", id: COMMUNITY_ID, reason: "Public builders" },
        ],
        actions: [
          {
            type: "FOLLOW_USER",
            targetId: USER_ID,
            requiresConfirmation: false,
          },
          { type: "FOLLOW_USER", targetId: FAKE_ID },
          {
            type: "DRAFT_MESSAGE",
            targetId: USER_ID,
            draft: "Hello from Nexus",
          },
        ],
      },
      evidence,
    );

    expect(normalized.suggestions.map((item) => item.id)).toEqual([
      USER_ID,
      COMMUNITY_ID,
    ]);
    expect(normalized.actions).toEqual([
      {
        type: "FOLLOW_USER",
        targetId: USER_ID,
        requiresConfirmation: true,
      },
      {
        type: "DRAFT_MESSAGE",
        targetId: USER_ID,
        draft: "Hello from Nexus",
        requiresConfirmation: true,
      },
    ]);
    expect(normalized.sources.some((source) => source.id === USER_ID)).toBe(true);
  });

  it("does not keep suggestions or actions when tools returned nothing", () => {
    const normalized = normalizeAgentOutput(
      {
        message: "I found Ada and several secret communities.",
        suggestions: [{ type: "user", id: USER_ID, reason: "Invented" }],
        actions: [{ type: "FOLLOW_USER", targetId: USER_ID }],
      },
      emptyEvidence(),
    );
    expect(normalized.suggestions).toEqual([]);
    expect(normalized.actions).toEqual([]);
    expect(normalized.message).toContain("did not find");
  });

  it("serializes only public agent fields", () => {
    const serialized = serializeAgentResponse({
      message: "Try this community.",
      sources: [{ type: "community", id: COMMUNITY_ID, name: "Builders" }],
      suggestions: [
        { type: "community", id: COMMUNITY_ID, reason: "Public and on-topic" },
      ],
      actions: [
        {
          type: "JOIN_COMMUNITY",
          targetId: COMMUNITY_ID,
          requiresConfirmation: true,
        },
      ],
    });
    const json = JSON.stringify(serialized);
    expect(serialized.actions[0]?.requiresConfirmation).toBe(true);
    expect(json).not.toContain("password");
    expect(json).not.toContain("email");
    expect(json).not.toContain("token");
    expect(json).not.toContain("prompt");
  });
});
