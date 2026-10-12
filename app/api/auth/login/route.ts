import { loginUser, serializePublicUser } from "@/lib/auth";
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
    const result = await loginUser(
      {
        email: body.email,
        password: body.password,
      },
      readSessionToken(request),
    );

    return jsonResponse(
      { user: serializePublicUser(result.user) },
      200,
      sessionCookies(result.session),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
