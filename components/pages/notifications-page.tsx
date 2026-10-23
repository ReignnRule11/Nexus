"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, userMessageForError, withCursor } from "@/lib/client/api";
import type { PageResult, PublicNotification } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton, StatusMessage } from "@/components/ui/status";

function notificationHref(notification: PublicNotification): string | null {
  if (notification.target.postId) {
    return `/posts/${notification.target.postId}`;
  }
  if (notification.target.conversationId) {
    return `/messages/${notification.target.conversationId}`;
  }
  if (notification.target.communityId) {
    return `/communities/${notification.target.communityId}`;
  }
  if (notification.actor) {
    return `/users/${notification.actor.userId}`;
  }
  return null;
}

function notificationText(notification: PublicNotification): string {
  const actor = notification.actor?.displayName ?? "Someone";
  switch (notification.type) {
    case "FOLLOW":
      return `${actor} followed you`;
    case "COMMENT":
      return `${actor} commented on a post`;
    case "REACTION":
      return `${actor} liked a post`;
    case "MESSAGE":
      return `${actor} sent a message`;
    case "COMMUNITY_MEMBER_JOINED":
      return `${actor} joined a community`;
    case "COMMUNITY_ROLE_CHANGED":
      return `${actor} changed a community role`;
    default:
      return "Notification";
  }
}

export function NotificationsPage() {
  const [items, setItems] = useState<PublicNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load(nextCursor: string | null, append: boolean) {
    setLoading(!append);
    setError(null);
    try {
      const result = await apiRequest<PageResult<PublicNotification>>(
        withCursor("/api/notifications", nextCursor),
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

  async function markRead(id: string) {
    setActionError(null);
    try {
      const result = await apiRequest<{ id: string; readAt: string }>(
        `/api/notifications/${id}/read`,
        { method: "POST" },
      );
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, readAt: result.readAt } : item)),
      );
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  async function markAll() {
    setActionError(null);
    try {
      await apiRequest("/api/notifications/read-all", { method: "POST" });
      const now = new Date().toISOString();
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  if (loading && items.length === 0) {
    return <Skeleton label="Loading notifications" />;
  }
  if (error && items.length === 0) {
    return <ErrorState message={error} onRetry={() => void load(null, false)} />;
  }

  return (
    <div className="stack">
      <div className="row space-between">
        <h1>Notifications</h1>
        <Button variant="secondary" onClick={() => void markAll()}>
          Mark all read
        </Button>
      </div>
      {actionError ? <StatusMessage tone="error">{actionError}</StatusMessage> : null}
      {items.length === 0 ? (
        <EmptyState title="No notifications" description="Activity from people you know will appear here." />
      ) : (
        <ul className="stack list-reset">
          {items.map((notification) => {
            const href = notificationHref(notification);
            const unread = !notification.readAt;
            return (
              <li key={notification.id}>
                <Card className={unread ? "unread-card" : undefined}>
                  <p className="wrap">
                    {unread ? <strong>Unread. </strong> : null}
                    {href ? <Link href={href}>{notificationText(notification)}</Link> : notificationText(notification)}
                  </p>
                  {!notification.readAt ? (
                    <Button variant="ghost" onClick={() => void markRead(notification.id)}>
                      Mark read
                    </Button>
                  ) : null}
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
