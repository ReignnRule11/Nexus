import {
  errorResponse,
  jsonResponse,
  readSessionToken,
} from "@/lib/auth-http";
import { listMyReports, serializePublicReporterReport } from "@/lib/moderation";
import { parsePageParams } from "@/lib/pagination";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = parsePageParams(url.searchParams);
    const result = await listMyReports(readSessionToken(request), page);
    return jsonResponse({
      items: result.items.map(serializePublicReporterReport),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
