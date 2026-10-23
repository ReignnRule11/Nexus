"use client";

import { useEffect, useState } from "react";
import { apiRequest, userMessageForError, withCursor } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import type { PageResult, PublicChannel, PublicCommunity, PublicPost } from "@/lib/client/types";
import { PostCard } from "@/components/feed/post-card";
import { PostComposer } from "@/components/feed/composer";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/status";

export function ChannelPage({
  channelId,
}: {
  communityId: string;
  channelId: string;
}) {
  const { user } = useSession();
  const [channel, setChannel] = useState<PublicChannel | null>(null);
  const [community, setCommunity] = useState<PublicCommunity | null>(null);
  const [items, setItems] = useState<PublicPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [channelResult, posts] = await Promise.all([
        apiRequest<{ channel: PublicChannel; community: PublicCommunity }>(
          `/api/channels/${channelId}`,
        ),
        apiRequest<PageResult<PublicPost>>(`/api/channels/${channelId}/posts`),
      ]);
      setChannel(channelResult.channel);
      setCommunity(channelResult.community);
      setItems(posts.items);
      setCursor(posts.nextCursor);
    } catch (caught) {
      setError(userMessageForError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Fetch on route id change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  async function loadMore() {
    if (!cursor) {
      return;
    }
    try {
      const posts = await apiRequest<PageResult<PublicPost>>(
        withCursor(`/api/channels/${channelId}/posts`, cursor),
      );
      setItems((current) => [...current, ...posts.items]);
      setCursor(posts.nextCursor);
    } catch (caught) {
      setError(userMessageForError(caught));
    }
  }

  if (loading) {
    return <Skeleton label="Loading channel" />;
  }
  if (error || !channel) {
    return <ErrorState message={error ?? "Channel not available."} onRetry={() => void load()} />;
  }

  const canPost =
    Boolean(community?.viewerIsMember) &&
    (channel.type !== "ANNOUNCEMENT" ||
      community?.viewerRole === "OWNER" ||
      community?.viewerRole === "ADMIN");

  return (
    <div className="stack">
      <p className="muted wrap">{community?.name}</p>
      <h1 className="wrap">{channel.name}</h1>
      {channel.description ? <p className="wrap">{channel.description}</p> : null}
      {canPost ? (
        <PostComposer
          channelId={channelId}
          onCreated={(post) => setItems((current) => [post, ...current])}
        />
      ) : null}
      {items.length === 0 ? (
        <EmptyState title="No posts" description="Channel posts appear here in chronological order." />
      ) : (
        <ul className="stack list-reset">
          {items.map((post) => (
            <li key={post.id}>
              <PostCard
                post={post}
                currentUserId={user?.id}
                onChanged={(updated) =>
                  setItems((current) =>
                    current.map((item) => (item.id === updated.id ? updated : item)),
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <Button variant="secondary" onClick={() => void loadMore()}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
