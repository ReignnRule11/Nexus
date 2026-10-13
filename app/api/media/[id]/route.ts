import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import { deleteMedia, getMediaAccess, serializePublicMedia } from "@/lib/media";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const result = await getMediaAccess(readSessionToken(request), id);
    return jsonResponse({
      media: serializePublicMedia(result.media),
      download: {
        url: result.download.url,
        method: result.download.method,
        expiresAt: result.download.expiresAt.toISOString(),
      },
    });
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
    const result = await deleteMedia(readSessionToken(request), id);
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
