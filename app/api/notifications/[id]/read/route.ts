import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import { markNotificationRead } from "@/lib/notifications";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    const result = await markNotificationRead(readSessionToken(request), id);
    return jsonResponse({
      id: result.id,
      readAt: result.readAt.toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
