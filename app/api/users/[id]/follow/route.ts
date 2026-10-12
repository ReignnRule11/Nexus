import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import {
  followUser,
  serializeRelationshipState,
  unfollowUser,
} from "@/lib/graph";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    const relationship = await followUser(readSessionToken(request), id);
    return jsonResponse({ relationship: serializeRelationshipState(relationship) });
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
    const relationship = await unfollowUser(readSessionToken(request), id);
    return jsonResponse({ relationship: serializeRelationshipState(relationship) });
  } catch (error) {
    return errorResponse(error);
  }
}
