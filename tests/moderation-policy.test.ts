import { describe, expect, it } from "vitest";
import {
  MODERATION_ABUSE_PROTECTION_MODE,
  MODERATION_ABUSE_PROTECTION_NOTE,
  createDisabledModerationAbuseLimiter,
} from "@/lib/moderation-abuse";
import {
  MODERATION_SEMANTICS,
  enforcementActionTypes,
  isActiveReportStatus,
  isEnforcementActionType,
  isModerationActionType,
  isReportReason,
  isReportStatus,
  isReportTargetType,
  moderationLimits,
  reportReasons,
  reportStatuses,
  reportTargetTypes,
} from "@/lib/moderation-policy";

describe("moderation policy", () => {
  it("limits report targets and reasons to the supported enums", () => {
    expect(reportTargetTypes).toEqual([
      "USER",
      "POST",
      "COMMENT",
      "MESSAGE",
      "COMMUNITY",
    ]);
    expect(isReportTargetType("POST")).toBe(true);
    expect(isReportTargetType("MEDIA")).toBe(false);
    expect(isReportReason("SPAM")).toBe(true);
    expect(isReportReason("OFF_TOPIC")).toBe(false);
    expect(isReportStatus("OPEN")).toBe(true);
    expect(isActiveReportStatus("OPEN")).toBe(true);
    expect(isActiveReportStatus("RESOLVED")).toBe(false);
    expect(reportReasons).toHaveLength(10);
    expect(reportStatuses).toEqual([
      "OPEN",
      "UNDER_REVIEW",
      "RESOLVED",
      "DISMISSED",
    ]);
  });

  it("limits enforcement to reversible moderator actions", () => {
    expect(enforcementActionTypes).toEqual([
      "HIDE_CONTENT",
      "RESTORE_CONTENT",
      "WARN_USER",
      "SUSPEND_USER",
      "UNSUSPEND_USER",
    ]);
    expect(isEnforcementActionType("HIDE_CONTENT")).toBe(true);
    expect(isEnforcementActionType("PERMANENT_DELETE")).toBe(false);
    expect(isModerationActionType("VIEW_PRIVATE_MESSAGE")).toBe(true);
    expect(isModerationActionType("BAN_IP")).toBe(false);
  });

  it("bounds explanation and request size", () => {
    expect(moderationLimits.explanationMaxLength).toBe(500);
    expect(moderationLimits.reasonNoteMaxLength).toBe(500);
    expect(moderationLimits.maxRequestBytes).toBe(8192);
    expect(moderationLimits.maxPageSize).toBe(50);
  });

  it("documents role, privacy, audit, and AI boundaries", () => {
    expect(MODERATION_SEMANTICS.role).toContain("out-of-band");
    expect(MODERATION_SEMANTICS.reporting).toContain("cannot report their own");
    expect(MODERATION_SEMANTICS.privacy).toContain(
      "never include private message bodies",
    );
    expect(MODERATION_SEMANTICS.enforcement).toContain(
      "cannot suspend themselves",
    );
    expect(MODERATION_SEMANTICS.audit).toContain("not tamper-proof");
    expect(MODERATION_SEMANTICS.ai).toContain("cannot file reports");
  });

  it("does not claim production report rate limiting", () => {
    expect(MODERATION_ABUSE_PROTECTION_MODE).toBe("disabled");
    expect(MODERATION_ABUSE_PROTECTION_NOTE).toMatch(/production rate limiting/i);
    expect(createDisabledModerationAbuseLimiter().check("report:user")).toEqual({
      allowed: true,
    });
  });
});
