import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import { initiateUpload, serializePublicMedia } from "@/lib/media";

export async function POST(request: Request) {
  try {
    protectMutation(request);
    const body = await readJsonObject(request);
    const result = await initiateUpload(readSessionToken(request), {
      filename: body.filename,
      mimeType: body.mimeType,
      byteSize: body.byteSize,
    });
    return jsonResponse(
      {
        media: serializePublicMedia(result.media),
        upload: {
          url: result.upload.url,
          method: result.upload.method,
          headers: result.upload.headers,
          expiresAt: result.upload.expiresAt.toISOString(),
        },
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
