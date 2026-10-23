"use client";

import { useEffect, useState } from "react";
import { apiRequest, userMessageForError, withCursor } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import type { PageResult, PublicComment, PublicPost } from "@/lib/client/types";
import { PostCard } from "@/components/feed/post-card";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { ReportDialog } from "@/components/ui/report-dialog";
import { EmptyState, ErrorState, Skeleton, StatusMessage } from "@/components/ui/status";

export function PostPage({ postId }: { postId: string }) {
  const { user } = useSession();
  const [post, setPost] = useState<PublicPost | null>(null);
  const [comments, setComments] = useState<PublicComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [reportCommentId, setReportCommentId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [postResult, commentResult] = await Promise.all([
        apiRequest<{ post: PublicPost }>(`/api/posts/${postId}`),
        apiRequest<PageResult<PublicComment>>(`/api/posts/${postId}/comments`),
      ]);
      setPost(postResult.post);
      setComments(commentResult.items);
      setCursor(commentResult.nextCursor);
    } catch (caught) {
      setError(userMessageForError(caught));
      setPost(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Fetch on post id change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  async function submitComment(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setCommentError(null);
    try {
      const result = await apiRequest<{ comment: PublicComment }>(`/api/posts/${postId}/comments`, {
        method: "POST",
        body: { body },
      });
      setBody("");
      setComments((current) => [...current, result.comment]);
      setPost((current) =>
        current ? { ...current, commentCount: current.commentCount + 1 } : current,
      );
    } catch (caught) {
      setCommentError(userMessageForError(caught));
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return <Skeleton label="Loading post" />;
  }
  if (error || !post) {
    return (
      <ErrorState
        title="Post not available"
        message={error ?? "This post may be deleted, hidden, or blocked."}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="stack">
      <h1>Post</h1>
      <PostCard post={post} currentUserId={user?.id} onChanged={setPost} />
      <form onSubmit={submitComment} className="stack card">
        <Field id="comment-body" label="Add a comment" required>
          <Textarea
            id="comment-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={2000}
            rows={3}
            required
          />
        </Field>
        {commentError ? <StatusMessage tone="error">{commentError}</StatusMessage> : null}
        <Button type="submit" disabled={pending || body.trim().length === 0}>
          {pending ? "Posting..." : "Comment"}
        </Button>
      </form>
      <h2>Comments</h2>
      {comments.length === 0 ? (
        <EmptyState title="No comments" description="Be the first to comment." />
      ) : (
        <ul className="stack list-reset">
          {comments.map((comment) => (
            <li key={comment.id}>
              <Card>
                <div className="post-header">
                  <Avatar name={comment.author.displayName} />
                  <div className="min-width-zero">
                    <p className="author-name wrap">{comment.author.displayName}</p>
                    <p className="muted wrap">@{comment.author.username}</p>
                  </div>
                </div>
                <p className="wrap">{comment.body}</p>
                {user && user.id !== comment.author.userId ? (
                  <Button variant="ghost" onClick={() => setReportCommentId(comment.id)}>
                    Report
                  </Button>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <Button
          variant="secondary"
          onClick={async () => {
            const result = await apiRequest<PageResult<PublicComment>>(
              withCursor(`/api/posts/${postId}/comments`, cursor),
            );
            setComments((current) => [...current, ...result.items]);
            setCursor(result.nextCursor);
          }}
        >
          Load more
        </Button>
      ) : null}
      <ReportDialog
        open={Boolean(reportCommentId)}
        onClose={() => setReportCommentId(null)}
        targetType="COMMENT"
        targetId={reportCommentId ?? ""}
      />
    </div>
  );
}
