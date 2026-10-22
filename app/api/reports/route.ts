import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import { HttpError } from "@/lib/http-error";
import {
  assertBoundedRequestSize,
  createReport,
  serializePublicReporterReport,
} from "@/lib/moderation";

async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "JSON body required.");
  }
  const raw = await request.text();
  assertBoundedRequestSize(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    protectMutation(request);
    const body = await readBoundedJson(request);
    const report = await createReport(readSessionToken(request), {
      targetType: body.targetType,
      targetId: body.targetId,
      reason: body.reason,
      explanation: body.explanation,
    });
    return jsonResponse(
      { report: serializePublicReporterReport(report) },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
