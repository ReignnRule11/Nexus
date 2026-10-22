import {
  errorResponse,
  jsonResponse,
  readSessionToken,
} from "@/lib/auth-http";
import {
  listModerationQueue,
  parseQueueFilters,
  serializePublicModeratorReport,
} from "@/lib/moderation";
import { parsePageParams } from "@/lib/pagination";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = parsePageParams(url.searchParams);
    const filters = parseQueueFilters(url.searchParams);
    const result = await listModerationQueue(
      readSessionToken(request),
      page,
      filters,
    );
    return jsonResponse({
      items: result.items.map(serializePublicModeratorReport),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
