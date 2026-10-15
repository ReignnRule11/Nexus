import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import { getMembership, leaveCommunity } from "@/lib/communities";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const membership = await getMembership(readSessionToken(request), id);
    return jsonResponse({
      membership: {
        communityId: membership.communityId,
        isMember: membership.isMember,
        role: membership.role,
        joinedAt: membership.joinedAt ? membership.joinedAt.toISOString() : null,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    await leaveCommunity(readSessionToken(request), id);
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
