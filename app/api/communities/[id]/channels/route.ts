import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import {
  createChannel,
  listChannels,
  serializePublicChannel,
} from "@/lib/communities";
import { parsePageParams } from "@/lib/pagination";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const page = parsePageParams(new URL(request.url).searchParams);
    const result = await listChannels(readSessionToken(request), id, page);
    return jsonResponse({
      items: result.items.map(serializePublicChannel),
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
    const channel = await createChannel(readSessionToken(request), id, {
      name: body.name,
      type: body.type,
      description: body.description,
    });
    return jsonResponse({ channel: serializePublicChannel(channel) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
