import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import { addReaction, removeReaction } from "@/lib/posts";

async function optionalJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {};
  }
  return readJsonObject(request);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    const body = await optionalJson(request);
    const result = await addReaction(readSessionToken(request), id, body);
    return jsonResponse(result);
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
    const body = await optionalJson(request);
    const result = await removeReaction(readSessionToken(request), id, body);
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
