"use client";

import { useEffect, useState } from "react";
import { apiRequest, userMessageForError, withCursor } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import type { PageResult, PublicConversation, PublicMessage } from "@/lib/client/types";
import { MediaPreview } from "@/components/media/media-preview";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { ReportDialog } from "@/components/ui/report-dialog";
import { EmptyState, ErrorState, Skeleton, StatusMessage } from "@/components/ui/status";

export function ConversationPage({ conversationId }: { conversationId: string }) {
  const { user } = useSession();
  const [conversation, setConversation] = useState<PublicConversation | null>(null);
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [conversationResult, messageResult] = await Promise.all([
        apiRequest<{ conversation: PublicConversation }>(`/api/conversations/${conversationId}`),
        apiRequest<PageResult<PublicMessage>>(`/api/conversations/${conversationId}/messages`),
      ]);
      setConversation(conversationResult.conversation);
      const ordered = [...messageResult.items].reverse();
      setMessages(ordered);
      setCursor(messageResult.nextCursor);
      const latest = ordered[ordered.length - 1];
      if (latest) {
        await apiRequest(`/api/conversations/${conversationId}/read`, {
          method: "POST",
          body: { messageId: latest.id },
        }).catch(() => undefined);
      }
    } catch (caught) {
      setError(userMessageForError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Fetch on conversation id change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setSendError(null);
    try {
      const result = await apiRequest<{ message: PublicMessage }>(
        `/api/conversations/${conversationId}/messages`,
        { method: "POST", body: { body } },
      );
      setBody("");
      setMessages((current) => [...current, result.message]);
    } catch (caught) {
      setSendError(userMessageForError(caught));
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return <Skeleton label="Loading conversation" />;
  }
  if (error || !conversation) {
    return (
      <ErrorState message={error ?? "Conversation not available."} onRetry={() => void load()} />
    );
  }

  return (
    <div className="stack conversation-layout">
      <h1 className="wrap">
        {conversation.otherParticipant?.displayName ?? "Conversation"}
      </h1>
      <p className="muted">Messages are sent through the server. There is no live delivery.</p>
      {messages.length === 0 ? (
        <EmptyState title="No messages" description="Send the first message." />
      ) : (
        <ul className="stack list-reset message-list">
          {messages.map((message) => (
            <li key={message.id} className="message-item">
              <Avatar name={message.sender.displayName} size="sm" />
              <div className="min-width-zero">
                <p className="author-name wrap">{message.sender.displayName}</p>
                {message.deleted ? (
                  <p className="muted">This message was deleted.</p>
                ) : (
                  <>
                    <p className="wrap">{message.body}</p>
                    {message.media.map((item) => (
                      <MediaPreview key={item.id} media={item} />
                    ))}
                  </>
                )}
                {user && user.id !== message.sender.userId && !message.deleted ? (
                  <Button variant="ghost" onClick={() => setReportId(message.id)}>
                    Report
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <Button
          variant="secondary"
          onClick={async () => {
            const result = await apiRequest<PageResult<PublicMessage>>(
              withCursor(`/api/conversations/${conversationId}/messages`, cursor),
            );
            setMessages((current) => [...result.items].reverse().concat(current));
            setCursor(result.nextCursor);
          }}
        >
          Load earlier messages
        </Button>
      ) : null}
      <form onSubmit={send} className="composer-bar stack">
        <Field id="message-body" label="Message" required>
          <Textarea
            id="message-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={4000}
            rows={3}
            required
          />
        </Field>
        {sendError ? <StatusMessage tone="error">{sendError}</StatusMessage> : null}
        <Button type="submit" disabled={pending || body.trim().length === 0}>
          {pending ? "Sending..." : "Send"}
        </Button>
      </form>
      <ReportDialog
        open={Boolean(reportId)}
        onClose={() => setReportId(null)}
        targetType="MESSAGE"
        targetId={reportId ?? ""}
      />
    </div>
  );
}
