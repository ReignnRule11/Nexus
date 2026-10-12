import { describe, expect, it } from "vitest";
import {
  isValidBio,
  isValidDisplayName,
  isValidEmail,
  isValidPassword,
  isValidUsername,
  normalizeBio,
  normalizeDisplayName,
  normalizeEmail,
  normalizeUsername,
} from "@/lib/identity";

describe("identity username rules", () => {
  it("normalizes usernames for unique lookup", () => {
    expect(normalizeUsername("Ada_Lovelace")).toBe("ada_lovelace");
  });

  it("rejects usernames outside the allowed length and character set", () => {
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("a".repeat(33))).toBe(false);
    expect(isValidUsername("not valid")).toBe(false);
    expect(isValidUsername("Ada_Lovelace")).toBe(true);
  });
});

describe("identity email rules", () => {
  it("normalizes emails", () => {
    expect(normalizeEmail(" Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("rejects invalid emails", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("ada@example.com")).toBe(true);
  });
});

describe("identity profile and password rules", () => {
  it("validates display names and bios", () => {
    expect(isValidDisplayName("Ada Lovelace")).toBe(true);
    expect(isValidDisplayName("")).toBe(false);
    expect(isValidDisplayName("a".repeat(81))).toBe(false);
    expect(normalizeDisplayName("  Ada  ")).toBe("Ada");
    expect(normalizeBio("  hello  ")).toBe("hello");
    expect(normalizeBio("   ")).toBeNull();
    expect(isValidBio(null)).toBe(true);
    expect(isValidBio("a".repeat(501))).toBe(false);
  });

  it("enforces password length bounds", () => {
    expect(isValidPassword("short")).toBe(false);
    expect(isValidPassword("a".repeat(12))).toBe(true);
    expect(isValidPassword("a".repeat(129))).toBe(false);
  });
});
