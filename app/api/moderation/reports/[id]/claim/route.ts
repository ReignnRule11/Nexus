import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import { claimReport, serializePublicModeratorReport } from "@/lib/moderation";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    const report = await claimReport(readSessionToken(request), id);
    return jsonResponse({ report: serializePublicModeratorReport(report) });
  } catch (error) {
    return errorResponse(error);
  }
}
