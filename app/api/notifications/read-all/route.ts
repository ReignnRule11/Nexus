import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import { markAllNotificationsRead } from "@/lib/notifications";

export async function POST(request: Request) {
  try {
    protectMutation(request);
    const result = await markAllNotificationsRead(readSessionToken(request));
    return jsonResponse({ updated: result.updated });
  } catch (error) {
    return errorResponse(error);
  }
}
