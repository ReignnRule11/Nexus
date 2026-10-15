import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import {
  deleteChannel,
  getChannel,
  serializePublicChannel,
  serializePublicCommunity,
  updateChannel,
} from "@/lib/communities";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const result = await getChannel(readSessionToken(request), id);
    return jsonResponse({
      channel: serializePublicChannel(result.channel),
      community: serializePublicCommunity(result.community),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const channel = await updateChannel(readSessionToken(request), id, {
      name: body.name,
      type: body.type,
      description: body.description,
    });
    return jsonResponse({ channel: serializePublicChannel(channel) });
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
    await deleteChannel(readSessionToken(request), id);
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
