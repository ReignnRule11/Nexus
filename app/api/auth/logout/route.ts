import { logoutSession } from "@/lib/auth";
import {
  clearedAuthCookies,
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";

export async function POST(request: Request) {
  try {
    const sessionToken = readSessionToken(request);
    if (sessionToken) {
      protectMutation(request);
      await logoutSession(sessionToken);
    }

    return jsonResponse({ ok: true }, 200, clearedAuthCookies());
  } catch (error) {
    return errorResponse(error);
  }
}
