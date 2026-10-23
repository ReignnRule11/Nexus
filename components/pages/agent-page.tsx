"use client";

import { useState } from "react";
import { apiRequest, isApiError, userMessageForError } from "@/lib/client/api";
import type { AgentResponse } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { EmptyState, StatusMessage } from "@/components/ui/status";

export function AgentPage() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResponse | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const body = await apiRequest<AgentResponse>("/api/ai/agent", {
        method: "POST",
        body: { message },
      });
      setResult(body);
    } catch (caught) {
      setResult(null);
      if (isApiError(caught) && (caught.code === "not_configured" || caught.code === "ai_unavailable")) {
        setError("The AI Social Agent is unavailable.");
      } else {
        setError(userMessageForError(caught));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <h1>AI Social Agent</h1>
      <p className="muted">
        The agent can retrieve authorized discovery context and draft proposed actions. It does not
        follow, message, join, post, or change accounts. Proposed actions always require your
        confirmation in the existing product flows.
      </p>
      <form onSubmit={onSubmit} className="stack card">
        <Field id="agent-message" label="Ask the agent" required>
          <Textarea
            id="agent-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={2000}
            rows={4}
            required
          />
        </Field>
        <Button type="submit" disabled={pending || message.trim().length === 0}>
          {pending ? "Thinking..." : "Send"}
        </Button>
      </form>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {result ? (
        <div className="stack">
          <Card>
            <h2>Response</h2>
            <p className="wrap">{result.message}</p>
          </Card>
          {result.sources.length > 0 ? (
            <Card>
              <h2>Sources</h2>
              <ul>
                {result.sources.map((source) => (
                  <li key={`${source.type}-${source.id}`} className="wrap">
                    {source.type}: {source.name}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {result.suggestions.length > 0 ? (
            <Card>
              <h2>Suggestions</h2>
              <ul>
                {result.suggestions.map((suggestion) => (
                  <li key={`${suggestion.type}-${suggestion.id}`} className="wrap">
                    {suggestion.type}: {suggestion.reason}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {result.actions.length > 0 ? (
            <Card>
              <h2>Proposed actions</h2>
              <p className="muted">These require confirmation. They are not executed automatically.</p>
              <ul>
                {result.actions.map((action, index) => (
                  <li key={`${action.type}-${index}`}>
                    {action.type}
                    {"targetId" in action ? ` ${action.targetId}` : ""}
                    {"draft" in action ? `: ${action.draft}` : ""}
                    {" "}
                    (requires confirmation)
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <EmptyState
              title="No proposed actions"
              description="The agent did not propose any follow, join, or draft actions."
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
