import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import {
  listMessages,
  sendMessage,
  serializePublicMessage,
} from "@/lib/messaging";
import { parsePageParams } from "@/lib/pagination";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const page = parsePageParams(new URL(request.url).searchParams);
    const result = await listMessages(readSessionToken(request), id, page);
    return jsonResponse({
      items: result.items.map(serializePublicMessage),
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
    const message = await sendMessage(readSessionToken(request), id, {
      body: body.body,
      mediaIds: body.mediaIds,
    });
    return jsonResponse({ message: serializePublicMessage(message) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
