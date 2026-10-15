import {
  errorResponse,
  jsonResponse,
  readSessionToken,
} from "@/lib/auth-http";
import {
  listMembers,
  serializePublicCommunityMember,
} from "@/lib/communities";
import { parsePageParams } from "@/lib/pagination";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const page = parsePageParams(new URL(request.url).searchParams);
    const result = await listMembers(readSessionToken(request), id, page);
    return jsonResponse({
      items: result.items.map(serializePublicCommunityMember),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
