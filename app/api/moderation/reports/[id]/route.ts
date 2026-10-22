import {
  errorResponse,
  jsonResponse,
  readSessionToken,
} from "@/lib/auth-http";
import {
  getModerationReport,
  serializePublicModeratorReport,
} from "@/lib/moderation";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const report = await getModerationReport(readSessionToken(request), id);
    return jsonResponse({ report: serializePublicModeratorReport(report) });
  } catch (error) {
    return errorResponse(error);
  }
}
