import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import { createPost, serializePublicPost } from "@/lib/posts";

export async function POST(request: Request) {
  try {
    protectMutation(request);
    const body = await readJsonObject(request);
    const post = await createPost(readSessionToken(request), { body: body.body });
    return jsonResponse({ post: serializePublicPost(post) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
