"use client";

import { useState } from "react";
import { apiRequest, isApiError, userMessageForError } from "@/lib/client/api";
import type { PublicPost } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { StatusMessage } from "@/components/ui/status";

export function PostComposer({
  onCreated,
  channelId,
}: {
  onCreated?: (post: PublicPost) => void;
  channelId?: string;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldError(undefined);
    try {
      const path = channelId ? `/api/channels/${channelId}/posts` : "/api/posts";
      const result = await apiRequest<{ post: PublicPost }>(path, {
        method: "POST",
        body: { body },
      });
      setBody("");
      onCreated?.(result.post);
    } catch (caught) {
      if (isApiError(caught) && caught.fields?.body) {
        setFieldError(caught.fields.body);
      }
      setError(userMessageForError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack card">
      <Field id="post-body" label="Write a post" required error={fieldError}>
        <Textarea
          id="post-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={5000}
          rows={4}
          error={fieldError}
          required
        />
      </Field>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      <Button type="submit" disabled={pending || body.trim().length === 0}>
        {pending ? "Posting..." : "Post"}
      </Button>
    </form>
  );
}
