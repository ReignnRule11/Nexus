import "server-only";

import { loadAiConfig, type AiConfig } from "@/lib/env";
import { HttpError } from "@/lib/http-error";
import { AI_AGENT_LIMITS, AI_TOOL_NAMES, type AiToolName } from "@/lib/ai/policy";

export type AiChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
};

export type AiToolCall = {
  id: string;
  name: AiToolName;
  arguments: Record<string, unknown>;
};

export type AiGenerateRequest = {
  messages: AiChatMessage[];
  tools: Array<{
    name: AiToolName;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  allowTools: boolean;
};

export type AiGenerateResult =
  | { kind: "message"; text: string; raw: unknown }
  | { kind: "tool_calls"; calls: AiToolCall[] };

export type AiProviderMetadata = {
  provider: string;
  model: string;
};

export type AiProvider = {
  metadata(): AiProviderMetadata;
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
};

export type OpenAiCompatibleTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

let testOverride: AiProvider | undefined;

export function setAiProviderForTests(provider: AiProvider | undefined): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Test AI provider overrides are only available when NODE_ENV=test.");
  }
  testOverride = provider;
}

function missingAiConfig(): Error {
  return new Error(
    "Missing required configuration: USER_LLM_API_KEY, USER_LLM_BASE_URL, USER_LLM_MODEL. AI is unavailable until a user-provided provider is configured. Do not use fake credentials.",
  );
}

function providerUnavailable(code: "ai_unavailable" | "ai_timeout" = "ai_unavailable"): HttpError {
  if (code === "ai_timeout") {
    return new HttpError(503, "ai_timeout", "AI is unavailable.");
  }
  return new HttpError(503, "ai_unavailable", "AI is unavailable.");
}

function joinUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}${path}`;
  }
  return `${trimmed}/v1${path}`;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined || raw === "") {
    return {};
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string") {
    throw providerUnavailable();
  }
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    throw providerUnavailable();
  }
  return parsed;
}

export function createOpenAiCompatibleProvider(
  config: AiConfig,
  transport: OpenAiCompatibleTransport = fetch,
): AiProvider {
  return {
    metadata() {
      return {
        provider: config.provider,
        model: config.model,
      };
    },
    async generate(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      const url = joinUrl(config.baseUrl, "/chat/completions");
      const body: Record<string, unknown> = {
        model: config.model,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.name ? { name: message.name } : {}),
        })),
        max_tokens: config.maxOutputTokens,
        temperature: 0,
      };
      if (request.allowTools) {
        body.tools = request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }));
        body.tool_choice = "auto";
      }

      let response: Response;
      try {
        response = await transport(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw providerUnavailable("ai_timeout");
        }
        throw providerUnavailable();
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw providerUnavailable();
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw providerUnavailable();
      }
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        throw providerUnavailable();
      }
      const record = payload as Record<string, unknown>;
      const choices = record.choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        throw providerUnavailable();
      }
      const first = choices[0];
      if (first === null || typeof first !== "object" || Array.isArray(first)) {
        throw providerUnavailable();
      }
      const message = (first as Record<string, unknown>).message;
      if (message === null || typeof message !== "object" || Array.isArray(message)) {
        throw providerUnavailable();
      }
      const messageRecord = message as Record<string, unknown>;
      const toolCalls = messageRecord.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        if (!request.allowTools) {
          throw providerUnavailable();
        }
        const calls: AiToolCall[] = [];
        for (const entry of toolCalls.slice(0, AI_AGENT_LIMITS.maxToolCallsPerRequest)) {
          if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
          }
          const call = entry as Record<string, unknown>;
          const fn = call.function;
          if (fn === null || typeof fn !== "object" || Array.isArray(fn)) {
            continue;
          }
          const fnRecord = fn as Record<string, unknown>;
          const name = fnRecord.name;
          if (typeof name !== "string" || !(AI_TOOL_NAMES as readonly string[]).includes(name)) {
            continue;
          }
          const id = typeof call.id === "string" && call.id.length > 0 ? call.id : `tool-${calls.length}`;
          let args: Record<string, unknown>;
          try {
            args = parseToolArguments(fnRecord.arguments);
          } catch {
            continue;
          }
          calls.push({
            id,
            name: name as AiToolName,
            arguments: args,
          });
        }
        if (calls.length === 0) {
          throw providerUnavailable();
        }
        return { kind: "tool_calls", calls };
      }

      const content = messageRecord.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw providerUnavailable();
      }
      return { kind: "message", text: content, raw: payload };
    },
  };
}

export function getAiProvider(): AiProvider {
  if (process.env.NODE_ENV === "test" && testOverride) {
    return testOverride;
  }
  const config = loadAiConfig();
  if (!config) {
    throw missingAiConfig();
  }
  return createOpenAiCompatibleProvider(config);
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        throw providerUnavailable();
      }
    }
    throw providerUnavailable();
  }
}
