import {
  errorResponse,
  jsonResponse,
  readSessionToken,
} from "@/lib/auth-http";
import {
  listNotifications,
  serializePublicNotification,
} from "@/lib/notifications";
import { parsePageParams } from "@/lib/pagination";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = parsePageParams(url.searchParams);
    const result = await listNotifications(readSessionToken(request), page);
    return jsonResponse({
      items: result.items.map(serializePublicNotification),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
