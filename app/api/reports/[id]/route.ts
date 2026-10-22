import {
  errorResponse,
  jsonResponse,
  readSessionToken,
} from "@/lib/auth-http";
import { getMyReport, serializePublicReporterReport } from "@/lib/moderation";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const report = await getMyReport(readSessionToken(request), id);
    return jsonResponse({ report: serializePublicReporterReport(report) });
  } catch (error) {
    return errorResponse(error);
  }
}
