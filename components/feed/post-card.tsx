"use client";

import Link from "next/link";
import { useState } from "react";
import { apiRequest, userMessageForError } from "@/lib/client/api";
import type { PublicPost } from "@/lib/client/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MediaPreview } from "@/components/media/media-preview";
import { ReportDialog } from "@/components/ui/report-dialog";
import { StatusMessage } from "@/components/ui/status";

export function PostCard({
  post,
  currentUserId,
  onChanged,
}: {
  post: PublicPost;
  currentUserId?: string;
  onChanged?: (post: PublicPost) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  async function toggleLike() {
    setPending(true);
    setError(null);
    try {
      const result = await apiRequest<{ reactionCount: number; viewerHasLiked: boolean }>(
        `/api/posts/${post.id}/reactions`,
        { method: post.viewerHasLiked ? "DELETE" : "POST", body: { type: "LIKE" } },
      );
      onChanged?.({
        ...post,
        reactionCount: result.reactionCount,
        viewerHasLiked: result.viewerHasLiked,
      });
    } catch (caught) {
      setError(userMessageForError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <header className="post-header">
        <Avatar name={post.author.displayName} />
        <div className="min-width-zero">
          <Link href={`/users/${post.author.userId}`} className="author-name">
            {post.author.displayName}
          </Link>
          <p className="muted wrap">@{post.author.username}</p>
        </div>
      </header>
      <p className="post-body wrap">{post.body}</p>
      {post.media.length > 0 ? (
        <div className="media-grid">
          {post.media.map((item) => (
            <MediaPreview key={item.id} media={item} />
          ))}
        </div>
      ) : null}
      <footer className="post-actions">
        <Button variant="ghost" onClick={() => void toggleLike()} disabled={pending}>
          {post.viewerHasLiked ? "Unlike" : "Like"} ({post.reactionCount})
        </Button>
        <Link className="btn btn-ghost" href={`/posts/${post.id}`}>
          Comments ({post.commentCount})
        </Link>
        {currentUserId && currentUserId !== post.author.userId ? (
          <Button variant="ghost" onClick={() => setReportOpen(true)}>
            Report
          </Button>
        ) : null}
      </footer>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="POST"
        targetId={post.id}
      />
    </Card>
  );
}
