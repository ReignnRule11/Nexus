"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, isApiError, userMessageForError } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import type {
  PageResult,
  PublicChannel,
  PublicCommunity,
  PublicCommunityMember,
} from "@/lib/client/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ReportDialog } from "@/components/ui/report-dialog";
import { EmptyState, ErrorState, Skeleton, StatusMessage } from "@/components/ui/status";

export function CommunityDetailPage({ communityId }: { communityId: string }) {
  const { user } = useSession();
  const [community, setCommunity] = useState<PublicCommunity | null>(null);
  const [channels, setChannels] = useState<PublicChannel[]>([]);
  const [members, setMembers] = useState<PublicCommunityMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelType, setChannelType] = useState<"TEXT" | "ANNOUNCEMENT">("TEXT");
  const [channelDescription, setChannelDescription] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [communityResult, channelResult, memberResult] = await Promise.all([
        apiRequest<{ community: PublicCommunity }>(`/api/communities/${communityId}`),
        apiRequest<PageResult<PublicChannel>>(`/api/communities/${communityId}/channels`),
        apiRequest<PageResult<PublicCommunityMember>>(`/api/communities/${communityId}/members`).catch(
          (caught) => {
            if (isApiError(caught) && (caught.status === 403 || caught.status === 404)) {
              return { items: [], nextCursor: null };
            }
            throw caught;
          },
        ),
      ]);
      setCommunity(communityResult.community);
      setChannels(channelResult.items);
      setMembers(memberResult.items);
    } catch (caught) {
      setError(userMessageForError(caught));
      setCommunity(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Fetch on community id change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId]);

  async function join() {
    setActionError(null);
    try {
      const result = await apiRequest<{ community: PublicCommunity }>(
        `/api/communities/${communityId}/join`,
        { method: "POST" },
      );
      setCommunity(result.community);
      await load();
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  async function leave() {
    setActionError(null);
    try {
      await apiRequest(`/api/communities/${communityId}/membership`, { method: "DELETE" });
      await load();
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  async function createChannel(event: React.FormEvent) {
    event.preventDefault();
    setActionError(null);
    try {
      const result = await apiRequest<{ channel: PublicChannel }>(
        `/api/communities/${communityId}/channels`,
        {
          method: "POST",
          body: {
            name: channelName,
            type: channelType,
            description: channelDescription || undefined,
          },
        },
      );
      setChannelName("");
      setChannelDescription("");
      setChannels((current) => [...current, result.channel]);
    } catch (caught) {
      setActionError(userMessageForError(caught));
    }
  }

  if (loading) {
    return <Skeleton label="Loading community" />;
  }
  if (error || !community) {
    return <ErrorState message={error ?? "Community not available."} onRetry={() => void load()} />;
  }

  const canManage = community.viewerRole === "OWNER" || community.viewerRole === "ADMIN";

  return (
    <div className="stack">
      <h1 className="wrap">{community.name}</h1>
      <p className="wrap">{community.description ?? "No description."}</p>
      <p className="muted">
        {community.visibility === "PUBLIC" ? "Public" : "Private"} · {community.memberCount} members
      </p>
      <div className="row">
        {community.viewerIsMember ? (
          community.viewerRole !== "OWNER" ? (
            <Button variant="secondary" onClick={() => void leave()}>
              Leave
            </Button>
          ) : null
        ) : (
          <Button onClick={() => void join()}>Join</Button>
        )}
        {user && community.owner?.userId !== user.id ? (
          <Button variant="ghost" onClick={() => setReportOpen(true)}>
            Report
          </Button>
        ) : null}
      </div>
      {actionError ? <StatusMessage tone="error">{actionError}</StatusMessage> : null}

      <h2>Channels</h2>
      {channels.length === 0 ? (
        <EmptyState title="No channels" description="Channels appear here when you can access them." />
      ) : (
        <ul className="stack list-reset">
          {channels.map((channel) => (
            <li key={channel.id}>
              <Card>
                <Link
                  href={`/communities/${communityId}/channels/${channel.id}`}
                  className="author-name wrap"
                >
                  {channel.name}
                </Link>
                <p className="muted">{channel.type === "ANNOUNCEMENT" ? "Announcement" : "Text"}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form onSubmit={createChannel} className="stack card">
          <h2>Add channel</h2>
          <Field id="channel-name" label="Name" required>
            <Input
              id="channel-name"
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
              required
            />
          </Field>
          <Field id="channel-type" label="Type" required>
            <Select
              id="channel-type"
              value={channelType}
              onChange={(event) =>
                setChannelType(event.target.value === "ANNOUNCEMENT" ? "ANNOUNCEMENT" : "TEXT")
              }
            >
              <option value="TEXT">Text</option>
              <option value="ANNOUNCEMENT">Announcement</option>
            </Select>
          </Field>
          <Field id="channel-description" label="Description">
            <Textarea
              id="channel-description"
              value={channelDescription}
              onChange={(event) => setChannelDescription(event.target.value)}
              rows={2}
            />
          </Field>
          <Button type="submit">Create channel</Button>
        </form>
      ) : null}

      <h2>Members</h2>
      {members.length === 0 ? (
        <p className="muted">Member list is not available.</p>
      ) : (
        <ul className="stack list-reset">
          {members.map((member) => (
            <li key={member.userId}>
              <Card>
                <div className="post-header">
                  <Avatar name={member.profile?.displayName ?? "Member"} />
                  <div className="min-width-zero">
                    {member.profile ? (
                      <Link href={`/users/${member.userId}`} className="author-name wrap">
                        {member.profile.displayName}
                      </Link>
                    ) : (
                      <span>Unavailable member</span>
                    )}
                    <p className="muted">{member.role}</p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="COMMUNITY"
        targetId={communityId}
      />
    </div>
  );
}
