import {
  errorResponse,
  jsonResponse,
  readSessionToken,
} from "@/lib/auth-http";
import {
  getRelationshipView,
  serializeRelationshipState,
} from "@/lib/graph";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const view = await getRelationshipView(readSessionToken(request), id);
    return jsonResponse({
      relationship: serializeRelationshipState(view.relationship),
      counts: view.counts,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
