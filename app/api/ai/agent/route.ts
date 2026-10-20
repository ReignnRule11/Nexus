import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readSessionToken,
} from "@/lib/auth-http";
import { HttpError } from "@/lib/http-error";
import { runSocialAgent, toPublicAgentResponse } from "@/lib/ai/agent";
import { AI_AGENT_LIMITS } from "@/lib/ai/policy";

async function readBoundedJson(request: Request): Promise<{
  raw: string;
  value: unknown;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "JSON body required.");
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > AI_AGENT_LIMITS.maxRequestBytes) {
    throw new HttpError(413, "payload_too_large", "Request is too large.", {
      message: `Request body must be at most ${AI_AGENT_LIMITS.maxRequestBytes} bytes.`,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  return { raw, value: parsed };
}

export async function POST(request: Request) {
  try {
    protectMutation(request);
    const body = await readBoundedJson(request);
    const result = await runSocialAgent(
      readSessionToken(request),
      body.value,
      body.raw,
    );
    return jsonResponse(toPublicAgentResponse(result));
  } catch (error) {
    return errorResponse(error);
  }
}
