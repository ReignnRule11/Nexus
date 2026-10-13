import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import { completeUpload, serializePublicMedia } from "@/lib/media";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    protectMutation(request);
    const { id } = await context.params;
    const media = await completeUpload(readSessionToken(request), id);
    return jsonResponse({ media: serializePublicMedia(media) });
  } catch (error) {
    return errorResponse(error);
  }
}
