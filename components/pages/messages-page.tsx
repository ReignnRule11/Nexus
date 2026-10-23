"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, userMessageForError, withCursor } from "@/lib/client/api";
import type { PageResult, PublicConversation } from "@/lib/client/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/status";

export function MessagesPage() {
  const [items, setItems] = useState<PublicConversation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(nextCursor: string | null, append: boolean) {
    setLoading(!append);
    setError(null);
    try {
      const result = await apiRequest<PageResult<PublicConversation>>(
        withCursor("/api/conversations", nextCursor),
      );
      setItems((current) => (append ? [...current, ...result.items] : result.items));
      setCursor(result.nextCursor);
    } catch (caught) {
      setError(userMessageForError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(null, false);
  }, []);

  if (loading && items.length === 0) {
    return <Skeleton label="Loading conversations" />;
  }
  if (error && items.length === 0) {
    return <ErrorState message={error} onRetry={() => void load(null, false)} />;
  }

  return (
    <div className="stack">
      <h1>Messages</h1>
      <p className="muted">
        Messages are sent through normal server requests. This page does not use realtime updates.
      </p>
      {items.length === 0 ? (
        <EmptyState
          title="No conversations"
          description="Start a conversation from a person's profile."
        />
      ) : (
        <ul className="stack list-reset">
          {items.map((conversation) => {
            const other = conversation.otherParticipant;
            const preview = conversation.lastMessage?.deleted
              ? "Message deleted"
              : conversation.lastMessage?.body ?? "No messages yet";
            return (
              <li key={conversation.id}>
                <Card>
                  <Link href={`/messages/${conversation.id}`} className="conversation-link">
                    <div className="post-header">
                      <Avatar name={other?.displayName ?? "Conversation"} />
                      <div className="min-width-zero">
                        <p className="author-name wrap">{other?.displayName ?? "Unknown"}</p>
                        <p className="muted wrap">{preview}</p>
                      </div>
                      {conversation.unreadCount > 0 ? (
                        <Badge tone="accent">{conversation.unreadCount}</Badge>
                      ) : null}
                    </div>
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {cursor ? (
        <Button variant="secondary" onClick={() => void load(cursor, true)}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
