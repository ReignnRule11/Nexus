import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import {
  serializePublicCommunityMember,
  updateMemberRole,
} from "@/lib/communities";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    protectMutation(request);
    const { id, userId } = await context.params;
    const body = await readJsonObject(request);
    const member = await updateMemberRole(readSessionToken(request), id, userId, {
      role: body.role,
    });
    return jsonResponse({
      member: serializePublicCommunityMember(member),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
