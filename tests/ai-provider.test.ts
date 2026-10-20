import { afterEach, describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  createOpenAiCompatibleProvider,
  getAiProvider,
  parseModelJson,
  setAiProviderForTests,
  type AiProvider,
} from "@/lib/ai/provider";

const config = {
  provider: "openai-compatible",
  model: "example-model",
  apiKey: "not-a-real-key",
  baseUrl: "https://llm.example.test/v1",
  timeoutMs: 50,
  maxOutputTokens: 64,
};

afterEach(() => {
  if (process.env.NODE_ENV === "test") {
    setAiProviderForTests(undefined);
  }
});

describe("AI provider", () => {
  it("fails closed when configuration is absent", () => {
    const previous = {
      key: process.env.USER_LLM_API_KEY,
      url: process.env.USER_LLM_BASE_URL,
      model: process.env.USER_LLM_MODEL,
    };
    delete process.env.USER_LLM_API_KEY;
    delete process.env.USER_LLM_BASE_URL;
    delete process.env.USER_LLM_MODEL;
    try {
      expect(() => getAiProvider()).toThrow(/USER_LLM_API_KEY, USER_LLM_BASE_URL, USER_LLM_MODEL/);
    } finally {
      if (previous.key === undefined) {
        delete process.env.USER_LLM_API_KEY;
      } else {
        process.env.USER_LLM_API_KEY = previous.key;
      }
      if (previous.url === undefined) {
        delete process.env.USER_LLM_BASE_URL;
      } else {
        process.env.USER_LLM_BASE_URL = previous.url;
      }
      if (previous.model === undefined) {
        delete process.env.USER_LLM_MODEL;
      } else {
        process.env.USER_LLM_MODEL = previous.model;
      }
    }
  });

  it("normalizes a successful chat completion without returning credentials", async () => {
    const provider = createOpenAiCompatibleProvider(config, async (input, init) => {
      expect(String(input)).toBe("https://llm.example.test/v1/chat/completions");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer not-a-real-key");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"message":"ok","suggestions":[],"actions":[]}' } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const result = await provider.generate({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      allowTools: false,
    });
    expect(result.kind).toBe("message");
    if (result.kind === "message") {
      expect(result.text).toContain("ok");
      expect(JSON.stringify(result)).not.toContain("not-a-real-key");
    }
    expect(provider.metadata()).toEqual({
      provider: "openai-compatible",
      model: "example-model",
    });
  });

  it("parses declared tool calls and ignores unknown tools", async () => {
    const provider = createOpenAiCompatibleProvider(config, async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "call-1",
                    function: {
                      name: "searchUsers",
                      arguments: JSON.stringify({ query: "ada" }),
                    },
                  },
                  {
                    id: "call-x",
                    function: { name: "executeSql", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const result = await provider.generate({
      messages: [{ role: "user", content: "find ada" }],
      tools: [
        {
          name: "searchUsers",
          description: "search",
          parameters: { type: "object" },
        },
      ],
      allowTools: true,
    });
    expect(result).toEqual({
      kind: "tool_calls",
      calls: [
        {
          id: "call-1",
          name: "searchUsers",
          arguments: { query: "ada" },
        },
      ],
    });
  });

  it("normalizes provider errors and timeouts without leaking secrets", async () => {
    const failing = createOpenAiCompatibleProvider(config, async () => {
      throw new Error("secret=not-a-real-key");
    });
    await expect(
      failing.generate({ messages: [], tools: [], allowTools: false }),
    ).rejects.toMatchObject({ status: 503, code: "ai_unavailable" });

    const timedOut = createOpenAiCompatibleProvider(
      { ...config, timeoutMs: 5 },
      async (_input, init) => {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      },
    );
    await expect(
      timedOut.generate({ messages: [], tools: [], allowTools: false }),
    ).rejects.toMatchObject({ status: 503, code: "ai_timeout" });
  });

  it("parses model JSON and rejects invalid payloads", () => {
    expect(parseModelJson('```json\n{"message":"ok"}\n```')).toEqual({
      message: "ok",
    });
    expect(() => parseModelJson("not-json")).toThrow(HttpError);
  });

  it("allows a test override only when NODE_ENV=test", async () => {
    const stub: AiProvider = {
      metadata: () => ({ provider: "test", model: "stub" }),
      generate: async () => ({
        kind: "message",
        text: '{"message":"stub","suggestions":[],"actions":[]}',
        raw: {},
      }),
    };
    setAiProviderForTests(stub);
    const result = await getAiProvider().generate({
      messages: [],
      tools: [],
      allowTools: false,
    });
    expect(result.kind).toBe("message");
  });
});
