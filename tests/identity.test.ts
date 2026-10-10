import { describe, expect, it } from "vitest";
import { isValidUsername, normalizeUsername } from "@/lib/identity";

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
