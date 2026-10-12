import {
  errorResponse,
  jsonResponse,
} from "@/lib/auth-http";
import { readViewerId } from "@/lib/graph-http";
import { listFollowers, serializePublicGraphProfile } from "@/lib/graph";
import { parsePageParams } from "@/lib/pagination";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const page = parsePageParams(new URL(request.url).searchParams);
    const viewerId = await readViewerId(request);
    const result = await listFollowers(viewerId, id, page);
    return jsonResponse({
      items: result.items.map(serializePublicGraphProfile),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
