import "server-only";

import { HttpError } from "@/lib/http-error";

export type Principal =
  | { kind: "anonymous" }
  | { kind: "authenticated"; userId: string; status: "ACTIVE" }
  | {
      kind: "inactive";
      userId: string;
      status: "SUSPENDED" | "DELETED";
    };

export function isAccountOwner(
  principalUserId: string,
  resourceOwnerId: string,
): boolean {
  return principalUserId === resourceOwnerId;
}

export function assertAccountOwner(
  principalUserId: string,
  resourceOwnerId: string,
): void {
  if (!isAccountOwner(principalUserId, resourceOwnerId)) {
    throw new HttpError(403, "forbidden", "You cannot modify this resource.");
  }
}

export function isTrustedModerator(isModerator: boolean): boolean {
  return isModerator === true;
}

export function assertTrustedModerator(isModerator: boolean): void {
  if (!isTrustedModerator(isModerator)) {
    throw new HttpError(403, "forbidden", "You cannot perform that action.");
  }
}
