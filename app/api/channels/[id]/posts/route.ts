import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import { parsePageParams } from "@/lib/pagination";
import {
  createChannelPost,
  listChannelPosts,
  serializePublicPost,
} from "@/lib/posts";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const page = parsePageParams(new URL(request.url).searchParams);
    const result = await listChannelPosts(readSessionToken(request), id, page);
    return jsonResponse({
      items: result.items.map(serializePublicPost),
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
    const post = await createChannelPost(readSessionToken(request), id, {
      body: body.body,
      mediaIds: body.mediaIds,
    });
    return jsonResponse({ post: serializePublicPost(post) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
