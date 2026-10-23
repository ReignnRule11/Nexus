"use client";

import { useEffect, useState } from "react";
import { apiRequest, isApiError, userMessageForError } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import type { GraphCounts, GraphProfile, PageResult, PublicProfile } from "@/lib/client/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton, StatusMessage } from "@/components/ui/status";

export function OwnProfilePage() {
  const { user, setUser } = useSession();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [counts, setCounts] = useState<GraphCounts | null>(null);
  const [followers, setFollowers] = useState<GraphProfile[]>([]);
  const [following, setFollowing] = useState<GraphProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    if (!user) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [profileResult, relationship, followerResult, followingResult] = await Promise.all([
        apiRequest<{ profile: PublicProfile }>("/api/profile"),
        apiRequest<{ counts: GraphCounts | null }>(`/api/users/${user.id}/relationship`),
        apiRequest<PageResult<GraphProfile>>(`/api/users/${user.id}/followers`),
        apiRequest<PageResult<GraphProfile>>(`/api/users/${user.id}/following`),
      ]);
      setProfile(profileResult.profile);
      setUsername(profileResult.profile.username);
      setDisplayName(profileResult.profile.displayName);
      setBio(profileResult.profile.bio ?? "");
      setCounts(relationship.counts);
      setFollowers(followerResult.items);
      setFollowing(followingResult.items);
    } catch (caught) {
      setError(userMessageForError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Fetch when the signed-in user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const result = await apiRequest<{ profile: PublicProfile }>("/api/profile", {
        method: "PATCH",
        body: { username, displayName, bio },
      });
      setProfile(result.profile);
      if (user) {
        setUser({ ...user, profile: result.profile });
      }
      setSaved(true);
    } catch (caught) {
      if (isApiError(caught) && caught.fields) {
        setSaveError(Object.values(caught.fields).join(" "));
      } else {
        setSaveError(userMessageForError(caught));
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Skeleton label="Loading profile" />;
  }
  if (error || !profile) {
    return <ErrorState message={error ?? "Profile not available."} onRetry={() => void load()} />;
  }

  return (
    <div className="stack">
      <h1>Profile</h1>
      <Card>
        <div className="post-header">
          <Avatar name={profile.displayName} size="lg" />
          <div className="min-width-zero">
            <p className="author-name wrap">{profile.displayName}</p>
            <p className="muted wrap">@{profile.username}</p>
            {counts ? (
              <p className="muted">
                {counts.followerCount} followers · {counts.followingCount} following
              </p>
            ) : null}
          </div>
        </div>
      </Card>
      <form onSubmit={save} className="stack card">
        <h2>Edit profile</h2>
        <Field id="profile-username" label="Username" required>
          <Input
            id="profile-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </Field>
        <Field id="profile-display-name" label="Display name" required>
          <Input
            id="profile-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </Field>
        <Field id="profile-bio" label="Bio">
          <Textarea
            id="profile-bio"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            maxLength={500}
            rows={4}
          />
        </Field>
        {saveError ? <StatusMessage tone="error">{saveError}</StatusMessage> : null}
        {saved ? <StatusMessage tone="success">Profile updated.</StatusMessage> : null}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </form>
      <h2>Followers</h2>
      {followers.length === 0 ? (
        <EmptyState title="No followers yet" description="People who follow you will appear here." />
      ) : (
        <ul className="stack list-reset">
          {followers.map((item) => (
            <li key={item.userId} className="muted wrap">
              {item.displayName} @{item.username}
            </li>
          ))}
        </ul>
      )}
      <h2>Following</h2>
      {following.length === 0 ? (
        <EmptyState title="Not following anyone" description="People you follow will appear here." />
      ) : (
        <ul className="stack list-reset">
          {following.map((item) => (
            <li key={item.userId} className="muted wrap">
              {item.displayName} @{item.username}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
