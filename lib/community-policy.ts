export const communityLimits = {
  communityNameMinLength: 1,
  communityNameMaxLength: 80,
  slugMaxLength: 40,
  descriptionMaxLength: 500,
  channelNameMinLength: 1,
  channelNameMaxLength: 80,
  channelDescriptionMaxLength: 500,
} as const;

export const communityVisibilities = ["PUBLIC", "PRIVATE"] as const;
export type CommunityVisibility = (typeof communityVisibilities)[number];

export const communityRoles = ["OWNER", "ADMIN", "MEMBER"] as const;
export type CommunityRole = (typeof communityRoles)[number];

export const channelTypes = ["TEXT", "ANNOUNCEMENT"] as const;
export type ChannelType = (typeof channelTypes)[number];

const CONTROL_CHARS = /\p{Cc}/u;
const SLUG_ALLOWED = /^[a-z0-9-]+$/;

export function unicodeLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeCommunityName(value: string): string {
  return value.trim();
}

export function isValidCommunityName(value: string): boolean {
  const name = normalizeCommunityName(value);
  const length = unicodeLength(name);
  return (
    length >= communityLimits.communityNameMinLength &&
    length <= communityLimits.communityNameMaxLength &&
    !CONTROL_CHARS.test(name)
  );
}

export function normalizeDescription(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function isValidDescription(value: string | null): boolean {
  if (value === null) {
    return true;
  }
  return (
    unicodeLength(value) <= communityLimits.descriptionMaxLength &&
    !CONTROL_CHARS.test(value)
  );
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, communityLimits.slugMaxLength);
}

export function isValidSlugFormat(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= communityLimits.slugMaxLength &&
    SLUG_ALLOWED.test(value)
  );
}

export function isCommunityVisibility(value: unknown): value is CommunityVisibility {
  return (
    typeof value === "string" &&
    (communityVisibilities as readonly string[]).includes(value)
  );
}

export function isChannelType(value: unknown): value is ChannelType {
  return (
    typeof value === "string" && (channelTypes as readonly string[]).includes(value)
  );
}

export function isCommunityRole(value: unknown): value is CommunityRole {
  return (
    typeof value === "string" && (communityRoles as readonly string[]).includes(value)
  );
}

export function isPrivilegedRole(role: CommunityRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canManageChannels(role: CommunityRole): boolean {
  return isPrivilegedRole(role);
}

export function canManageMembers(role: CommunityRole): boolean {
  return role === "OWNER";
}

export function canWriteChannel(
  role: CommunityRole,
  channelType: ChannelType,
): boolean {
  if (channelType === "ANNOUNCEMENT") {
    return isPrivilegedRole(role);
  }
  return true;
}

export const COMMUNITY_SEMANTICS = {
  visibility:
    "PUBLIC communities are discoverable and readable, consistent with the existing discovery and post conventions. PRIVATE communities and all their channels are visible only to active members; non-members always receive 404 so private existence is never disclosed. Mutations always require an active authenticated user.",
  roles:
    "Exactly one active OWNER per community, enforced by a partial unique index. ADMINs manage channels and content. MEMBERs read/write normal TEXT channels. ANNOUNCEMENT channels are writable only by OWNER/ADMIN. Only the OWNER may change roles or transfer ownership.",
  blocking:
    "Blocking takes precedence. A blocked pair is hidden from each other in discovery, membership, member lists, channel content, and community posts, and cannot join or interact through a community.",
  membership:
    "Memberships are unique per (community, user). Members who leave are soft-marked with leftAt and reactivated on rejoin. Deleted accounts never appear as active members. OWNER cannot leave without transferring ownership first.",
} as const;
