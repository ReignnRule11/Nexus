import { describe, expect, it } from "vitest";
import {
  canManageChannels,
  canManageMembers,
  canWriteChannel,
  COMMUNITY_SEMANTICS,
  communityLimits,
  isChannelType,
  isCommunityRole,
  isCommunityVisibility,
  isPrivilegedRole,
  isValidCommunityName,
  isValidDescription,
  isValidSlugFormat,
  normalizeDescription,
  slugify,
} from "@/lib/community-policy";

describe("community policy", () => {
  it("validates and normalizes community names", () => {
    expect(isValidCommunityName("Design Guild")).toBe(true);
    expect(isValidCommunityName("  Design Guild  ")).toBe(true);
    expect(isValidCommunityName("")).toBe(false);
    expect(isValidCommunityName("   ")).toBe(false);
    expect(isValidCommunityName("a".repeat(81))).toBe(false);
    expect(isValidCommunityName("bad\u0000name")).toBe(false);
    expect(communityLimits.communityNameMaxLength).toBe(80);
  });

  it("slugifies safely and bounded", () => {
    expect(slugify("Design Guild")).toBe("design-guild");
    expect(slugify("  Hello, World!!  ")).toBe("hello-world");
    expect(slugify("Café & 日本")).toBe("cafe");
    expect(slugify("---")).toBe("");
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(40);
    expect(isValidSlugFormat("design-guild")).toBe(true);
    expect(isValidSlugFormat("Design")).toBe(false);
    expect(isValidSlugFormat("a b")).toBe(false);
    expect(isValidSlugFormat("")).toBe(false);
  });

  it("handles descriptions with control-character awareness", () => {
    expect(normalizeDescription(undefined)).toBeNull();
    expect(normalizeDescription("   ")).toBeNull();
    expect(normalizeDescription(" hi ")).toBe("hi");
    expect(isValidDescription("a".repeat(500))).toBe(true);
    expect(isValidDescription("a".repeat(501))).toBe(false);
    expect(isValidDescription("bad\u0001")).toBe(false);
  });

  it("narrows visibility, role, and channel type values", () => {
    expect(isCommunityVisibility("PUBLIC")).toBe(true);
    expect(isCommunityVisibility("PRIVATE")).toBe(true);
    expect(isCommunityVisibility("SECRET")).toBe(false);
    expect(isCommunityRole("OWNER")).toBe(true);
    expect(isCommunityRole("ADMIN")).toBe(true);
    expect(isCommunityRole("MEMBER")).toBe(true);
    expect(isCommunityRole("MODERATOR")).toBe(false);
    expect(isChannelType("TEXT")).toBe(true);
    expect(isChannelType("ANNOUNCEMENT")).toBe(true);
    expect(isChannelType("VOICE")).toBe(false);
  });

  it("derives role capabilities", () => {
    expect(isPrivilegedRole("OWNER")).toBe(true);
    expect(isPrivilegedRole("ADMIN")).toBe(true);
    expect(isPrivilegedRole("MEMBER")).toBe(false);
    expect(canManageChannels("OWNER")).toBe(true);
    expect(canManageChannels("ADMIN")).toBe(true);
    expect(canManageChannels("MEMBER")).toBe(false);
    expect(canManageMembers("OWNER")).toBe(true);
    expect(canManageMembers("ADMIN")).toBe(false);
    expect(canWriteChannel("MEMBER", "TEXT")).toBe(true);
    expect(canWriteChannel("MEMBER", "ANNOUNCEMENT")).toBe(false);
    expect(canWriteChannel("ADMIN", "ANNOUNCEMENT")).toBe(true);
  });

  it("documents visibility, role, and blocking semantics", () => {
    expect(COMMUNITY_SEMANTICS.visibility).toContain("PRIVATE");
    expect(COMMUNITY_SEMANTICS.roles).toContain("ANNOUNCEMENT");
    expect(COMMUNITY_SEMANTICS.blocking).toContain("Blocking takes precedence");
  });
});
