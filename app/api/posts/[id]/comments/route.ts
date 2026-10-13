import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import { parsePageParams } from "@/lib/pagination";
import {
  createComment,
  listComments,
  serializePublicComment,
} from "@/lib/posts";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const page = parsePageParams(new URL(request.url).searchParams);
    const result = await listComments(readSessionToken(request), id, page);
    return jsonResponse({
      items: result.items.map(serializePublicComment),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const comment = await createComment(readSessionToken(request), id, {
      body: body.body,
    });
    return jsonResponse({ comment: serializePublicComment(comment) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
