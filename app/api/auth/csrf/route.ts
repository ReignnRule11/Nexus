import { issueCsrfToken } from "@/lib/auth";
import { csrfSetCookie, errorResponse, jsonResponse, readCsrfCookie } from "@/lib/auth-http";

export async function GET(request: Request) {
  try {
    const existing = readCsrfCookie(request);
    const token = existing ?? issueCsrfToken();
    return jsonResponse(
      { csrfToken: token },
      200,
      existing ? [] : [csrfSetCookie(token)],
    );
  } catch (error) {
    return errorResponse(error);
  }
}
