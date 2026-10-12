import { describe, expect, it } from "vitest";
import { DISCOVERY_POLICY } from "@/lib/discovery";
import { GRAPH_SEMANTICS, serializePublicGraphProfile } from "@/lib/graph";

describe("graph policy", () => {
  it("documents block precedence and visibility", () => {
    expect(GRAPH_SEMANTICS.blockPrecedence).toMatch(/atomically deletes/i);
    expect(GRAPH_SEMANTICS.blockPrecedence).toMatch(/does not restore follows/i);
    expect(GRAPH_SEMANTICS.visibility).toMatch(/Deleted users are excluded/i);
    expect(GRAPH_SEMANTICS.visibility).toMatch(/Suspended users remain visible/i);
    expect(DISCOVERY_POLICY.search).toMatch(/Blocked pairs never appear/i);
  });

  it("serializes public graph profiles without private fields", () => {
    const serialized = serializePublicGraphProfile({
      userId: "11111111-1111-4111-8111-111111111111",
      username: "ada",
      displayName: "Ada",
      bio: "Builder",
    });
    expect(serialized).toEqual({
      userId: "11111111-1111-4111-8111-111111111111",
      username: "ada",
      displayName: "Ada",
      bio: "Builder",
    });
    expect(JSON.stringify(serialized)).not.toContain("password");
    expect(JSON.stringify(serialized)).not.toContain("session");
    expect(JSON.stringify(serialized)).not.toContain("email");
  });
});
