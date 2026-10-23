"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest, userMessageForError } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import type {
  GraphCounts,
  GraphProfile,
  PageResult,
  PublicConversation,
  RelationshipState,
} from "@/lib/client/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ReportDialog } from "@/components/ui/report-dialog";
import { EmptyState, ErrorState, Skeleton, StatusMessage } from "@/components/ui/status";

export function UserPage({ userId }: { userId: string }) {
  const router = useRouter();
  const { user } = useSession();
  const [profile, setProfile] = useState<GraphProfile | null>(null);
  const [relationship, setRelationship] = useState<RelationshipState | null>(null);
  const [counts, setCounts] = useState<GraphCounts | null>(null);
  const [followers, setFollowers] = useState<GraphProfile[]>([]);
  const [following, setFollowing] = useState<GraphProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const view = await apiRequest<{
        profile: GraphProfile;
        relationship: RelationshipState | null;
        counts: GraphCounts | null;
      }>(`/api/users/${userId}`);
      setProfile(view.profile);
      setRelationship(view.relationship);
      setCounts(view.counts);
      if (!view.relationship?.blocked) {
        const [followerResult, followingResult] = await Promise.all([
          apiRequest<PageResult<GraphProfile>>(`/api/users/${userId}/followers`),
          apiRequest<PageResult<GraphProfile>>(`/api/users/${userId}/following`),
        ]);
        setFollowers(followerResult.items);
        setFollowing(followingResult.items);
      } else {
        setFollowers([]);
        setFollowing([]);
      }
    } catch (caught) {
      setError(userMessageForError(caught));
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user?.id === userId) {
      router.replace("/profile");
      return;
    }
    void load();
    // Fetch on target or viewer change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, user?.id]);

  async function follow() {
    setActionError(null);
    try {
      const result = await apiRequest<{ relationship: RelationshipState }>(
        `/api/users/${userId}/follow`,
        { method: "POST" },
      );
      setRelationship(result.relationship);
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  async function unfollow() {
    setActionError(null);
    try {
      const result = await apiRequest<{ relationship: RelationshipState }>(
        `/api/users/${userId}/follow`,
        { method: "DELETE" },
      );
      setRelationship(result.relationship);
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  async function block() {
    setActionError(null);
    try {
      const result = await apiRequest<{ relationship: RelationshipState }>(
        `/api/users/${userId}/block`,
        { method: "POST" },
      );
      setRelationship(result.relationship);
      setCounts(null);
      setFollowers([]);
      setFollowing([]);
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  async function unblock() {
    setActionError(null);
    try {
      const result = await apiRequest<{ relationship: RelationshipState }>(
        `/api/users/${userId}/block`,
        { method: "DELETE" },
      );
      setRelationship(result.relationship);
      await load();
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  async function message() {
    setActionError(null);
    try {
      const result = await apiRequest<{ conversation: PublicConversation }>(
        "/api/conversations",
        { method: "POST", body: { userId } },
      );
      router.push(`/messages/${result.conversation.id}`);
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  if (loading) {
    return <Skeleton label="Loading profile" />;
  }
  if (error || !profile) {
    return <ErrorState message={error ?? "User not available."} onRetry={() => void load()} />;
  }

  return (
    <div className="stack">
      <Card>
        <div className="post-header">
          <Avatar name={profile.displayName} size="lg" />
          <div className="min-width-zero">
            <h1 className="author-name wrap">{profile.displayName}</h1>
            <p className="muted wrap">@{profile.username}</p>
            {profile.bio ? <p className="wrap">{profile.bio}</p> : null}
            {counts ? (
              <p className="muted">
                {counts.followerCount} followers · {counts.followingCount} following
              </p>
            ) : null}
          </div>
        </div>
      </Card>
      {relationship ? (
        <div className="row">
          {relationship.blocked ? (
            <Button variant="secondary" onClick={() => void unblock()}>
              Unblock
            </Button>
          ) : (
            <>
              {relationship.following ? (
                <Button variant="secondary" onClick={() => void unfollow()}>
                  Unfollow
                </Button>
              ) : (
                <Button onClick={() => void follow()}>Follow</Button>
              )}
              <Button variant="secondary" onClick={() => void message()}>
                Message
              </Button>
              <Button variant="ghost" onClick={() => void block()}>
                Block
              </Button>
              <Button variant="ghost" onClick={() => setReportOpen(true)}>
                Report
              </Button>
            </>
          )}
        </div>
      ) : null}
      {actionError ? <StatusMessage tone="error">{actionError}</StatusMessage> : null}
      {relationship?.blocked ? (
        <p className="muted">You blocked this account. Unblock to see more.</p>
      ) : (
        <>
          <h2>Followers</h2>
          {followers.length === 0 ? (
            <EmptyState title="No followers" description="Follower lists stay empty until people follow this account." />
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
            <EmptyState title="Not following anyone" description="Accounts this person follows will appear here." />
          ) : (
            <ul className="stack list-reset">
              {following.map((item) => (
                <li key={item.userId} className="muted wrap">
                  {item.displayName} @{item.username}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="USER"
        targetId={userId}
      />
    </div>
  );
}
