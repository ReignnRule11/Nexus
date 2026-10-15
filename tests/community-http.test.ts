import { describe, expect, it } from "vitest";
import { GET as listCommunities, POST as createCommunity } from "@/app/api/communities/route";
import { GET as getCommunity } from "@/app/api/communities/[id]/route";
import { POST as createChannel } from "@/app/api/communities/[id]/channels/route";
import { GET as getChannel } from "@/app/api/channels/[id]/route";
import { GET as listChannelPosts } from "@/app/api/channels/[id]/posts/route";
import { COMMUNITY_SEMANTICS } from "@/lib/communities";
import { toErrorBody } from "@/lib/http-error";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";

describe("community routes without a database", () => {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());

  it.skipIf(databaseConfigured)(
    "fails closed instead of returning fake communities",
    async () => {
      const response = await listCommunities(
        new Request("http://localhost/api/communities"),
      );
      const body = (await response.json()) as { error: { code: string } };
      expect(response.status).toBe(503);
      expect(body.error.code).toBe("not_configured");
    },
  );

  it.skipIf(databaseConfigured)(
    "fails closed for community, channel, and channel-post reads",
    async () => {
      const community = await getCommunity(
        new Request(`http://localhost/api/communities/${AGENT_ID}`),
        { params: Promise.resolve({ id: AGENT_ID }) },
      );
      expect(community.status).toBe(503);

      const channel = await getChannel(
        new Request(`http://localhost/api/channels/${AGENT_ID}`),
        { params: Promise.resolve({ id: AGENT_ID }) },
      );
      expect(channel.status).toBe(503);

      const posts = await listChannelPosts(
        new Request(`http://localhost/api/channels/${AGENT_ID}/posts`),
        { params: Promise.resolve({ id: AGENT_ID }) },
      );
      expect(posts.status).toBe(503);
    },
  );

  it("maps missing configuration without leaking internals", () => {
    const mapped = toErrorBody(
      new Error(
        "Missing required configuration: DATABASE_URL. PostgreSQL access is unavailable until a connection string is provided. Do not use fake credentials.",
      ),
    );
    expect(mapped.status).toBe(503);
    expect(mapped.body.error.code).toBe("not_configured");
    expect(JSON.stringify(mapped.body)).not.toContain("postgresql://");
  });

  it("documents community visibility and role semantics", () => {
    expect(COMMUNITY_SEMANTICS.visibility).toContain("404");
    expect(COMMUNITY_SEMANTICS.roles).toContain("OWNER");
  });

  it("exports community handlers", () => {
    expect(typeof listCommunities).toBe("function");
    expect(typeof createCommunity).toBe("function");
    expect(typeof getCommunity).toBe("function");
    expect(typeof createChannel).toBe("function");
    expect(typeof getChannel).toBe("function");
    expect(typeof listChannelPosts).toBe("function");
  });
});
