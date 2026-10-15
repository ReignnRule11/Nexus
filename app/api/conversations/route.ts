import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import {
  getOrCreateConversation,
  listConversations,
  serializePublicConversation,
} from "@/lib/messaging";
import { parsePageParams } from "@/lib/pagination";

export async function GET(request: Request) {
  try {
    const page = parsePageParams(new URL(request.url).searchParams);
    const result = await listConversations(readSessionToken(request), page);
    return jsonResponse({
      items: result.items.map(serializePublicConversation),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    protectMutation(request);
    const body = await readJsonObject(request);
    const result = await getOrCreateConversation(readSessionToken(request), {
      userId: body.userId,
    });
    return jsonResponse(
      { conversation: serializePublicConversation(result.conversation), created: result.created },
      result.created ? 201 : 200,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
