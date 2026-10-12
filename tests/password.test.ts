import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("hashes with argon2id and never stores plaintext", async () => {
    const password = "correct-horse-battery";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, "wrong-password-12")).toBe(false);
  });

  it("rejects malformed hashes without throwing", async () => {
    expect(await verifyPassword("not-a-hash", "correct-horse-battery")).toBe(
      false,
    );
  });
});
