"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, userMessageForError, withCursor } from "@/lib/client/api";
import type { PageResult, PublicCommunity } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton, StatusMessage } from "@/components/ui/status";

export function CommunitiesPage() {
  const [items, setItems] = useState<PublicCommunity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load(nextCursor: string | null, append: boolean) {
    setLoading(!append);
    setError(null);
    try {
      const result = await apiRequest<PageResult<PublicCommunity>>(
        withCursor("/api/communities", nextCursor),
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

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const result = await apiRequest<{ community: PublicCommunity }>("/api/communities", {
        method: "POST",
        body: { name, description, visibility },
      });
      setName("");
      setDescription("");
      setItems((current) => [result.community, ...current]);
    } catch (caught) {
      setCreateError(userMessageForError(caught));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="stack">
      <h1>Communities</h1>
      <form onSubmit={onCreate} className="stack card">
        <h2>Create a community</h2>
        <Field id="community-name" label="Name" required>
          <Input
            id="community-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
          />
        </Field>
        <Field id="community-description" label="Description">
          <Textarea
            id="community-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            rows={3}
          />
        </Field>
        <Field id="community-visibility" label="Visibility" required>
          <Select
            id="community-visibility"
            value={visibility}
            onChange={(event) =>
              setVisibility(event.target.value === "PRIVATE" ? "PRIVATE" : "PUBLIC")
            }
          >
            <option value="PUBLIC">Public</option>
            <option value="PRIVATE">Private</option>
          </Select>
        </Field>
        {createError ? <StatusMessage tone="error">{createError}</StatusMessage> : null}
        <Button type="submit" disabled={creating || name.trim().length === 0}>
          {creating ? "Creating..." : "Create"}
        </Button>
      </form>
      {loading && items.length === 0 ? <Skeleton label="Loading communities" /> : null}
      {error && items.length === 0 ? (
        <ErrorState message={error} onRetry={() => void load(null, false)} />
      ) : null}
      {!loading && items.length === 0 && !error ? (
        <EmptyState title="No communities" description="Create one to get started." />
      ) : null}
      <ul className="stack list-reset">
        {items.map((community) => (
          <li key={community.id}>
            <Card>
              <Link href={`/communities/${community.id}`} className="author-name wrap">
                {community.name}
              </Link>
              <p className="muted wrap">{community.description ?? "No description."}</p>
              <p className="muted">
                {community.visibility === "PUBLIC" ? "Public" : "Private"} · {community.memberCount}{" "}
                members
              </p>
            </Card>
          </li>
        ))}
      </ul>
      {cursor ? (
        <Button variant="secondary" onClick={() => void load(cursor, true)}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
