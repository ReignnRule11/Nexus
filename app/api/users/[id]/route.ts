import {
  errorResponse,
  jsonResponse,
  readSessionToken,
} from "@/lib/auth-http";
import {
  getPublicProfileView,
  serializePublicGraphProfile,
  serializeRelationshipState,
} from "@/lib/graph";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const view = await getPublicProfileView(readSessionToken(request), id);
    return jsonResponse({
      profile: serializePublicGraphProfile(view.profile),
      relationship: view.relationship
        ? serializeRelationshipState(view.relationship)
        : null,
      counts: view.counts,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
