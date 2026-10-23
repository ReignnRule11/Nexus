"use client";

import { useEffect, useState } from "react";
import { apiRequest, userMessageForError, withCursor } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import type { PageResult, PublicModeratorReport, PublicReportedMessage } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton, StatusMessage } from "@/components/ui/status";

export function ModerationPage() {
  const { user } = useSession();
  const [items, setItems] = useState<PublicModeratorReport[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PublicModeratorReport | null>(null);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState<PublicReportedMessage | null>(null);
  const [statusFilter, setStatusFilter] = useState("OPEN");

  async function load(nextCursor: string | null, append: boolean) {
    setLoading(!append);
    setError(null);
    try {
      const result = await apiRequest<PageResult<PublicModeratorReport>>(
        withCursor("/api/moderation/reports", nextCursor, { status: statusFilter }),
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
    // Refetch when the queue filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function claim(id: string) {
    setActionError(null);
    try {
      const result = await apiRequest<{ report: PublicModeratorReport }>(
        `/api/moderation/reports/${id}/claim`,
        { method: "POST" },
      );
      setSelected(result.report);
      setItems((current) => current.map((item) => (item.id === id ? result.report : item)));
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  async function resolve(id: string, kind: "resolve" | "dismiss") {
    setActionError(null);
    try {
      const result = await apiRequest<{ report: PublicModeratorReport }>(
        `/api/moderation/reports/${id}/${kind}`,
        { method: "POST", body: { reason: note } },
      );
      setSelected(result.report);
      setItems((current) => current.map((item) => (item.id === id ? result.report : item)));
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  async function enforce(
    actionType: "HIDE_CONTENT" | "RESTORE_CONTENT" | "WARN_USER" | "SUSPEND_USER" | "UNSUSPEND_USER",
    targetType: string,
    targetId: string,
  ) {
    if (!selected) {
      return;
    }
    setActionError(null);
    try {
      await apiRequest("/api/moderation/actions", {
        method: "POST",
        body: {
          actionType,
          targetType,
          targetId,
          reason: note || "moderation action",
          reportId: selected.id,
        },
      });
      const result = await apiRequest<{ report: PublicModeratorReport }>(
        `/api/moderation/reports/${selected.id}`,
      );
      setSelected(result.report);
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  async function viewMessage(id: string) {
    setActionError(null);
    try {
      const result = await apiRequest<{ message: PublicReportedMessage }>(
        `/api/moderation/reports/${id}/message`,
        { method: "POST" },
      );
      setMessageBody(result.message);
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  if (!user?.isModerator) {
    return (
      <ErrorState
        title="Not available"
        message="Moderation tools are only available to provisioned moderators."
      />
    );
  }

  if (loading && items.length === 0) {
    return <Skeleton label="Loading moderation queue" />;
  }
  if (error && items.length === 0) {
    return <ErrorState message={error} onRetry={() => void load(null, false)} />;
  }

  return (
    <div className="stack">
      <h1>Moderation</h1>
      <p className="muted">
        Queue access is authorized by the server. Hiding this page is not an authorization boundary.
      </p>
      <Field id="queue-status" label="Status">
        <Select
          id="queue-status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="OPEN">Open</option>
          <option value="UNDER_REVIEW">Under review</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DISMISSED">Dismissed</option>
        </Select>
      </Field>
      {items.length === 0 ? (
        <EmptyState title="No reports" description="Reports matching this filter will appear here." />
      ) : (
        <ul className="stack list-reset">
          {items.map((report) => (
            <li key={report.id}>
              <Card>
                <button type="button" className="linkish" onClick={() => setSelected(report)}>
                  {report.targetType} · {report.reason} · {report.status}
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <Button variant="secondary" onClick={() => void load(cursor, true)}>
          Load more
        </Button>
      ) : null}
      {selected ? (
        <Card>
          <h2>Report detail</h2>
          <p>
            {selected.targetType} {selected.targetId}
          </p>
          <p className="muted">Status: {selected.status}</p>
          <p className="wrap">{selected.explanation ?? "No explanation."}</p>
          {selected.reporter ? (
            <p className="muted">
              Reporter: {selected.reporter.displayName} @{selected.reporter.username}
            </p>
          ) : null}
          <Field id="moderation-note" label="Decision reason" required>
            <Textarea
              id="moderation-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              rows={3}
            />
          </Field>
          <div className="row">
            {selected.status === "OPEN" ? (
              <Button onClick={() => void claim(selected.id)}>Claim</Button>
            ) : null}
            {selected.status === "UNDER_REVIEW" ? (
              <>
                <Button onClick={() => void resolve(selected.id, "resolve")}>Resolve</Button>
                <Button variant="secondary" onClick={() => void resolve(selected.id, "dismiss")}>
                  Dismiss
                </Button>
              </>
            ) : null}
            {selected.targetType === "POST" || selected.targetType === "COMMENT" ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void enforce("HIDE_CONTENT", selected.targetType, selected.targetId)
                  }
                >
                  Hide
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void enforce("RESTORE_CONTENT", selected.targetType, selected.targetId)
                  }
                >
                  Restore
                </Button>
              </>
            ) : null}
            {selected.targetType === "USER" ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => void enforce("WARN_USER", "USER", selected.targetId)}
                >
                  Warn
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void enforce("SUSPEND_USER", "USER", selected.targetId)}
                >
                  Suspend
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void enforce("UNSUSPEND_USER", "USER", selected.targetId)}
                >
                  Unsuspend
                </Button>
              </>
            ) : null}
            {selected.targetType === "MESSAGE" ? (
              <Button variant="ghost" onClick={() => void viewMessage(selected.id)}>
                View private message
              </Button>
            ) : null}
          </div>
          {messageBody ? (
            <p className="wrap">
              {messageBody.deleted ? "Message deleted." : messageBody.body ?? "No body."}
            </p>
          ) : null}
          {actionError ? <StatusMessage tone="error">{actionError}</StatusMessage> : null}
        </Card>
      ) : null}
      {error ? <ErrorState message={error} onRetry={() => void load(null, false)} /> : null}
    </div>
  );
}
