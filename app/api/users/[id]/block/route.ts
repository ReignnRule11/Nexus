import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import {
  blockUser,
  serializeRelationshipState,
  unblockUser,
} from "@/lib/graph";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    const relationship = await blockUser(readSessionToken(request), id);
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
    const relationship = await unblockUser(readSessionToken(request), id);
    return jsonResponse({ relationship: serializeRelationshipState(relationship) });
  } catch (error) {
    return errorResponse(error);
  }
}
