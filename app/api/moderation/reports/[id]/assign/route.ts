import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import { assignReport, serializePublicModeratorReport } from "@/lib/moderation";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const report = await assignReport(readSessionToken(request), id, {
      moderatorId: body.moderatorId,
    });
    return jsonResponse({ report: serializePublicModeratorReport(report) });
  } catch (error) {
    return errorResponse(error);
  }
}
