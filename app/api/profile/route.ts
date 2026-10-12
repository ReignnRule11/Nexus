import {
  getOwnProfile,
  requireActiveUser,
  serializePublicProfile,
  updateOwnProfile,
} from "@/lib/auth";
import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";

export async function GET(request: Request) {
  try {
    const profile = await getOwnProfile(readSessionToken(request));
    return jsonResponse({ profile: serializePublicProfile(profile) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    protectMutation(request);
    const token = readSessionToken(request);
    const user = await requireActiveUser(token);
    const body = await readJsonObject(request);
    const profile = await updateOwnProfile(user.id, user.id, {
      username: body.username,
      displayName: body.displayName,
      bio: body.bio,
    });
    return jsonResponse({ profile: serializePublicProfile(profile) });
  } catch (error) {
    return errorResponse(error);
  }
}
