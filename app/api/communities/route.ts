import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import {
  createCommunity,
  listCommunities,
  serializePublicCommunity,
} from "@/lib/communities";
import { parsePageParams } from "@/lib/pagination";

function parseCommunityQuery(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const query = raw.trim();
  if (query.length === 0) {
    return null;
  }
  return query.slice(0, 80);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = parsePageParams(url.searchParams);
    const query = parseCommunityQuery(url.searchParams.get("q"));
    const result = await listCommunities(readSessionToken(request), {
      ...page,
      query,
    });
    return jsonResponse({
      items: result.items.map(serializePublicCommunity),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    protectMutation(request);
    const body = await readJsonObject(request);
    const community = await createCommunity(readSessionToken(request), {
      name: body.name,
      description: body.description,
      slug: body.slug,
      visibility: body.visibility,
    });
    return jsonResponse(
      { community: serializePublicCommunity(community) },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
