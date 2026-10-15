import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import {
  getConversation,
  hideConversation,
  serializePublicConversation,
} from "@/lib/messaging";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const conversation = await getConversation(readSessionToken(request), id);
    return jsonResponse({ conversation: serializePublicConversation(conversation) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    await hideConversation(readSessionToken(request), id);
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
