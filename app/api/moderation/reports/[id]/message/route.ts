import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import {
  serializePublicReportedMessage,
  viewReportedMessage,
} from "@/lib/moderation";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    const message = await viewReportedMessage(readSessionToken(request), id);
    return jsonResponse({ message: serializePublicReportedMessage(message) });
  } catch (error) {
    return errorResponse(error);
  }
}
