import { describe, expect, it } from "vitest";
import {
  contentLimits,
  isValidCommentBody,
  isValidPostBody,
} from "@/lib/content";
import { POST_VISIBILITY, serializePublicPost } from "@/lib/posts";

describe("content validation", () => {
  it("rejects blank and oversized post bodies", () => {
    expect(isValidPostBody("hello")).toBe(true);
    expect(isValidPostBody("   ")).toBe(false);
    expect(isValidPostBody("a".repeat(contentLimits.postBodyMaxLength))).toBe(
      true,
    );
    expect(
      isValidPostBody("a".repeat(contentLimits.postBodyMaxLength + 1)),
    ).toBe(false);
  });

  it("rejects blank and oversized comment bodies", () => {
    expect(isValidCommentBody("note")).toBe(true);
    expect(isValidCommentBody("")).toBe(false);
    expect(
      isValidCommentBody("a".repeat(contentLimits.commentBodyMaxLength + 1)),
    ).toBe(false);
  });
});

describe("post serialization", () => {
  it("omits private identity fields", () => {
    const serialized = serializePublicPost({
      id: "11111111-1111-4111-8111-111111111111",
      channelId: null,
      author: {
        userId: "22222222-2222-4222-8222-222222222222",
        username: "ada",
        displayName: "Ada",
        bio: null,
      },
      body: "hello",
      createdAt: new Date("2026-10-13T00:00:00.000Z"),
      updatedAt: new Date("2026-10-13T00:00:00.000Z"),
      commentCount: 0,
      reactionCount: 1,
      viewerHasLiked: true,
      media: [],
    });
    expect(JSON.stringify(serialized)).not.toContain("password");
    expect(JSON.stringify(serialized)).not.toContain("email");
    expect(JSON.stringify(serialized)).not.toContain("tokenHash");
    expect(POST_VISIBILITY.feed).toMatch(/createdAt DESC/);
  });
});
