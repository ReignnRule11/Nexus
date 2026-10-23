"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, userMessageForError, withCursor } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import type { PageResult, PublicPost } from "@/lib/client/types";
import { PostCard } from "@/components/feed/post-card";
import { PostComposer } from "@/components/feed/composer";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/status";

export function FeedPage() {
  const { user } = useSession();
  const [items, setItems] = useState<PublicPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextCursor: string | null, append: boolean) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const result = await apiRequest<PageResult<PublicPost>>(withCursor("/api/feed", nextCursor));
      setItems((current) => (append ? [...current, ...result.items] : result.items));
      setCursor(result.nextCursor);
    } catch (caught) {
      setError(userMessageForError(caught));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(null, false);
  }, [load]);

  if (loading) {
    return <Skeleton lines={5} label="Loading feed" />;
  }
  if (error && items.length === 0) {
    return <ErrorState message={error} onRetry={() => void load(null, false)} />;
  }

  return (
    <div className="stack">
      <h1>Home</h1>
      <PostComposer onCreated={(post) => setItems((current) => [post, ...current])} />
      {items.length === 0 ? (
        <EmptyState
          title="No posts yet"
          description="Follow people or create a post to see chronological updates here."
        />
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
      {error ? <ErrorState message={error} onRetry={() => void load(cursor, true)} /> : null}
      {cursor ? (
        <Button variant="secondary" disabled={loadingMore} onClick={() => void load(cursor, true)}>
          {loadingMore ? "Loading..." : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
