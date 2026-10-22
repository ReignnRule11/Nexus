import { describe, expect, it } from "vitest";
import {
  assertAccountOwner,
  assertTrustedModerator,
  isAccountOwner,
  isTrustedModerator,
} from "@/lib/authorization";
import { HttpError } from "@/lib/http-error";

describe("authorization primitives", () => {
  it("treats matching user ids as account owners", () => {
    expect(isAccountOwner("user-1", "user-1")).toBe(true);
    expect(isAccountOwner("user-1", "user-2")).toBe(false);
  });

  it("rejects unauthorized profile mutation", () => {
    expect(() => assertAccountOwner("user-1", "user-2")).toThrow(HttpError);
    expect(() => assertAccountOwner("user-1", "user-1")).not.toThrow();
  });

  it("does not treat request flags or emails as moderator credentials", () => {
    expect(isTrustedModerator(false)).toBe(false);
    expect(isTrustedModerator(true)).toBe(true);
    expect(() => assertTrustedModerator(false)).toThrow(HttpError);
    expect(() => assertTrustedModerator(true)).not.toThrow();
  });
});
