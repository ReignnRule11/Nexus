import { requireActiveUser, serializePublicUser } from "@/lib/auth";
import { errorResponse, jsonResponse, readSessionToken } from "@/lib/auth-http";

export async function GET(request: Request) {
  try {
    const user = await requireActiveUser(readSessionToken(request));
    return jsonResponse({ user: serializePublicUser(user) });
  } catch (error) {
    return errorResponse(error);
  }
}
