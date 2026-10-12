import {
  errorResponse,
  jsonResponse,
  readSessionToken,
} from "@/lib/auth-http";
import { parseSearchQuery, searchUsers, serializeSearchPage } from "@/lib/discovery";
import { parsePageParams } from "@/lib/pagination";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = parseSearchQuery(url.searchParams.get("q"));
    const page = parsePageParams(url.searchParams);
    const result = await searchUsers(readSessionToken(request), query, page);
    return jsonResponse(serializeSearchPage(result));
  } catch (error) {
    return errorResponse(error);
  }
}
