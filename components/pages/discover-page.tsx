"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, userMessageForError, withCursor } from "@/lib/client/api";
import type { GraphProfile, PageResult, PublicCommunity } from "@/lib/client/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/status";

export function DiscoverPage() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<GraphProfile[]>([]);
  const [communities, setCommunities] = useState<PublicCommunity[]>([]);
  const [userCursor, setUserCursor] = useState<string | null>(null);
  const [communityCursor, setCommunityCursor] = useState<string | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingCommunities, setLoadingCommunities] = useState(true);
  const [userError, setUserError] = useState<string | null>(null);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function loadCommunities(cursor: string | null, append: boolean) {
    setLoadingCommunities(true);
    setCommunityError(null);
    try {
      const result = await apiRequest<PageResult<PublicCommunity>>(
        withCursor("/api/communities", cursor),
      );
      setCommunities((current) => (append ? [...current, ...result.items] : result.items));
      setCommunityCursor(result.nextCursor);
    } catch (caught) {
      setCommunityError(userMessageForError(caught));
    } finally {
      setLoadingCommunities(false);
    }
  }

  useEffect(() => {
    void loadCommunities(null, false);
  }, []);

  async function searchUsers(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    setLoadingUsers(true);
    setUserError(null);
    setSearched(true);
    try {
      const result = await apiRequest<PageResult<GraphProfile>>(
        withCursor("/api/users/search", null, { q: trimmed }),
      );
      setUsers(result.items);
      setUserCursor(result.nextCursor);
    } catch (caught) {
      setUserError(userMessageForError(caught));
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }

  return (
    <div className="stack">
      <h1>Discover</h1>
      <form onSubmit={searchUsers} className="stack card" role="search">
        <Field id="discover-query" label="Search people">
          <Input
            id="discover-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={80}
            autoComplete="off"
          />
        </Field>
        <Button type="submit" disabled={loadingUsers || query.trim().length === 0}>
          {loadingUsers ? "Searching..." : "Search"}
        </Button>
      </form>
      {userError ? <ErrorState message={userError} /> : null}
      {loadingUsers ? <Skeleton label="Searching people" /> : null}
      {searched && !loadingUsers && users.length === 0 && !userError ? (
        <EmptyState title="No people found" description="Try a different username or display name." />
      ) : null}
      {users.length > 0 ? (
        <ul className="stack list-reset">
          {users.map((profile) => (
            <li key={profile.userId}>
              <Card>
                <div className="post-header">
                  <Avatar name={profile.displayName} />
                  <div className="min-width-zero">
                    <Link href={`/users/${profile.userId}`} className="author-name">
                      {profile.displayName}
                    </Link>
                    <p className="muted wrap">@{profile.username}</p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
      {userCursor ? (
        <p className="muted">More people match this search. Refine the query to narrow results.</p>
      ) : null}

      <h2>Communities</h2>
      {loadingCommunities && communities.length === 0 ? (
        <Skeleton label="Loading communities" />
      ) : null}
      {communityError && communities.length === 0 ? (
        <ErrorState message={communityError} onRetry={() => void loadCommunities(null, false)} />
      ) : null}
      {!loadingCommunities && communities.length === 0 && !communityError ? (
        <EmptyState title="No communities yet" description="Create one from the Communities page." />
      ) : null}
      <ul className="stack list-reset">
        {communities.map((community) => (
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
      {communityCursor ? (
        <Button variant="secondary" onClick={() => void loadCommunities(communityCursor, true)}>
          Load more communities
        </Button>
      ) : null}
    </div>
  );
}
