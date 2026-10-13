import {
  errorResponse,
  jsonResponse,
  readSessionToken,
} from "@/lib/auth-http";
import { parsePageParams } from "@/lib/pagination";
import { getFeed, serializePublicPost } from "@/lib/posts";

export async function GET(request: Request) {
  try {
    const page = parsePageParams(new URL(request.url).searchParams);
    const result = await getFeed(readSessionToken(request), page);
    return jsonResponse({
      items: result.items.map(serializePublicPost),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
