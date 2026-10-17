import { describe, expect, it } from "vitest";
import {
  commentEventKey,
  communityJoinEventKey,
  communityRoleEventKey,
  followEventKey,
  isNotificationType,
  messageEventKey,
  NOTIFICATION_SEMANTICS,
  notificationLimits,
  notificationTypes,
  reactionEventKey,
} from "@/lib/notification-policy";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("notification policy", () => {
  it("limits notification types to supported product events", () => {
    expect(notificationTypes).toEqual([
      "FOLLOW",
      "COMMENT",
      "REACTION",
      "MESSAGE",
      "COMMUNITY_MEMBER_JOINED",
      "COMMUNITY_ROLE_CHANGED",
    ]);
    expect(isNotificationType("FOLLOW")).toBe(true);
    expect(isNotificationType("MESSAGE")).toBe(true);
    expect(isNotificationType("MENTION")).toBe(false);
    expect(isNotificationType("REPOST")).toBe(false);
    expect(isNotificationType(null)).toBe(false);
  });

  it("builds deterministic event keys", () => {
    expect(followEventKey(ID_A)).toBe(`follow:${ID_A}`);
    expect(commentEventKey(ID_A)).toBe(`comment:${ID_A}`);
    expect(reactionEventKey(ID_A)).toBe(`reaction:${ID_A}`);
    expect(messageEventKey(ID_A)).toBe(`message:${ID_A}`);
    expect(communityJoinEventKey(ID_A, ID_B)).toBe(
      `community-join:${ID_A}:${ID_B}`,
    );
    const at = new Date("2026-10-16T12:00:00.000Z");
    expect(communityRoleEventKey(ID_A, at)).toBe(
      `community-role:${ID_A}:2026-10-16T12:00:00.000Z`,
    );
  });

  it("keeps event keys bounded", () => {
    expect(notificationLimits.eventKeyMaxLength).toBe(255);
    expect(() => followEventKey("x".repeat(300))).toThrow();
    expect(() => messageEventKey("x".repeat(300))).toThrow();
  });

  it("documents ownership, idempotency, and privacy semantics", () => {
    expect(NOTIFICATION_SEMANTICS.ownership).toContain("404");
    expect(NOTIFICATION_SEMANTICS.idempotency).toContain("unique event key");
    expect(NOTIFICATION_SEMANTICS.privacy).toContain("message bodies");
  });
});
