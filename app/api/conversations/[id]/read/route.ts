import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import { markConversationRead } from "@/lib/messaging";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const result = await markConversationRead(readSessionToken(request), id, {
      messageId: body.messageId,
    });
    return jsonResponse({
      unreadCount: result.unreadCount,
      lastReadAt: result.lastReadAt.toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
