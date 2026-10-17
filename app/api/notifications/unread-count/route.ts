import {
  errorResponse,
  jsonResponse,
  readSessionToken,
} from "@/lib/auth-http";
import { getUnreadNotificationCount } from "@/lib/notifications";

export async function GET(request: Request) {
  try {
    const unreadCount = await getUnreadNotificationCount(
      readSessionToken(request),
    );
    return jsonResponse({ unreadCount });
  } catch (error) {
    return errorResponse(error);
  }
}
