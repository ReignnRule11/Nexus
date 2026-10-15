import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import { joinCommunity, serializePublicCommunity } from "@/lib/communities";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    const community = await joinCommunity(readSessionToken(request), id);
    return jsonResponse({ community: serializePublicCommunity(community) });
  } catch (error) {
    return errorResponse(error);
  }
}
