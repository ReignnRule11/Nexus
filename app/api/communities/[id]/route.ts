import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import {
  deleteCommunity,
  getCommunity,
  serializePublicCommunity,
  updateCommunity,
} from "@/lib/communities";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const community = await getCommunity(readSessionToken(request), id);
    return jsonResponse({ community: serializePublicCommunity(community) });
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
    const community = await updateCommunity(readSessionToken(request), id, {
      name: body.name,
      description: body.description,
      visibility: body.visibility,
    });
    return jsonResponse({ community: serializePublicCommunity(community) });
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
    await deleteCommunity(readSessionToken(request), id);
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
