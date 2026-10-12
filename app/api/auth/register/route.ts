import { registerUser, serializePublicUser } from "@/lib/auth";
import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
  sessionCookies,
} from "@/lib/auth-http";

export async function POST(request: Request) {
  try {
    protectMutation(request);
    const body = await readJsonObject(request);
    const result = await registerUser(
      {
        email: body.email,
        password: body.password,
        username: body.username,
        displayName: body.displayName,
      },
      readSessionToken(request),
    );

    return jsonResponse(
      { user: serializePublicUser(result.user) },
      201,
      sessionCookies(result.session),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
