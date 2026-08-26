import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { characterAnalysisSchema } from "@/lib/prompts/schemas";
import {
  buildStructuredResponseFormat,
  requestOpenAiStructured,
} from "./openai-structured";

const schema = z.object({ value: z.number() }).strict();

describe("OpenAI structured requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds native strict JSON Schema only when requested", () => {
    expect(
      buildStructuredResponseFormat({
        mode: "json_object",
        schema,
        name: "sample",
      }),
    ).toEqual({ type: "json_object" });

    const native = buildStructuredResponseFormat({
      mode: "json_schema",
      schema,
      name: "sample schema",
    });
    expect(native.type).toBe("json_schema");
    if (native.type === "json_schema") {
      expect(native.json_schema.name).toBe("sample_schema");
      expect(native.json_schema.strict).toBe(true);
      expect(native.json_schema.schema).toMatchObject({
        type: "object",
        required: ["value"],
        additionalProperties: false,
      });
    }

    const optionalNative = buildStructuredResponseFormat({
      mode: "json_schema",
      schema: z
        .object({ value: z.number(), note: z.string().nullable().optional() })
        .strict(),
      name: "optional schema",
    });
    expect(optionalNative.type).toBe("json_schema");
    if (optionalNative.type === "json_schema")
      expect(optionalNative.json_schema.schema).toMatchObject({
        required: ["value", "note"],
        additionalProperties: false,
      });

    expect(
      buildStructuredResponseFormat({
        mode: "json_schema",
        schema: characterAnalysisSchema,
        name: "dynamic profile schema",
      }),
    ).toEqual({ type: "json_object" });
  });

  it("sends separate system and user messages and returns a trace", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "response-1",
          choices: [{ message: { content: '{"value":7}' } }],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 4,
            total_tokens: 16,
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const prompt = renderPrompt({
      id: PROMPT_IDS.STORY_CHARACTER_ANALYSIS,
      variables: {
        source_text: "source",
        character_library: "[]",
      },
    });

    const result = await requestOpenAiStructured({
      baseUrl: "https://provider.test/v1",
      apiKeys: ["test-key"],
      model: "test-model",
      prompt,
      schema,
    });

    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[0][1]?.body),
    ) as {
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string };
    };
    expect(requestBody.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
    expect(requestBody.messages[0].content).toContain("casting_director");
    expect(requestBody.response_format.type).toBe("json_object");
    expect(result.trace).toMatchObject({
      promptId: PROMPT_IDS.STORY_CHARACTER_ANALYSIS,
      agentId: "casting_director",
      model: "test-model",
      correctionAttempts: 0,
      repaired: false,
      tokenUsage: {
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
      },
    });
    expect(result.trace.outputHash).toHaveLength(64);
  });

  it("attaches owned visual references to the first user message", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse('{"value":7}'),
    );
    vi.stubGlobal("fetch", fetchMock);
    const prompt = renderPrompt({
      id: PROMPT_IDS.STORY_CHARACTER_ANALYSIS,
      variables: { source_text: "source", character_library: "[]" },
    });

    await requestOpenAiStructured({
      baseUrl: "https://provider.test/v1",
      apiKeys: ["test-key"],
      model: "vision-model",
      prompt,
      schema,
      imageUrls: ["https://media.test/reference.png"],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.messages[0].content).toEqual(expect.any(String));
    expect(body.messages[1].content).toEqual([
      { type: "text", text: prompt.text },
      {
        type: "image_url",
        image_url: { url: "https://media.test/reference.png" },
      },
    ]);
  });

  it("keeps semantic correction within one API key and accumulates usage", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse('{"value":1}', {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse('{"value":2}', {
          input_tokens: 14,
          output_tokens: 3,
          total_tokens: 17,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const prompt = renderPrompt({
      id: PROMPT_IDS.STORY_CHARACTER_ANALYSIS,
      variables: { source_text: "source", character_library: "[]" },
    });

    const result = await requestOpenAiStructured({
      baseUrl: "https://provider.test/v1",
      apiKeys: ["first-key", "second-key"],
      model: "test-model",
      prompt,
      schema,
      validate: (data) =>
        data.value === 2
          ? []
          : [{ code: "VALUE_INVALID", path: "value", message: "must be 2" }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.trace.correctionAttempts).toBe(1);
    expect(result.trace.tokenUsage).toEqual({
      inputTokens: 24,
      outputTokens: 5,
      totalTokens: 29,
    });
    for (const call of fetchMock.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer first-key");
    }
  });

  it("does not rotate API keys after semantic correction is exhausted", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse('{"value":1}'));
    vi.stubGlobal("fetch", fetchMock);
    const prompt = renderPrompt({
      id: PROMPT_IDS.STORY_CHARACTER_ANALYSIS,
      variables: { source_text: "source", character_library: "[]" },
    });

    await expect(
      requestOpenAiStructured({
        baseUrl: "https://provider.test/v1",
        apiKeys: ["first-key", "second-key"],
        model: "test-model",
        prompt,
        schema,
        validate: () => [
          { code: "VALUE_INVALID", path: "value", message: "always invalid" },
        ],
      }),
    ).rejects.toMatchObject({ code: "STRUCTURED_SEMANTIC_INVALID" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer first-key");
    }
  });

  it("uses the correction budget rendered from the agent contract", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse('{"value":1}'));
    vi.stubGlobal("fetch", fetchMock);
    const prompt = {
      ...renderPrompt({
        id: PROMPT_IDS.STORY_CHARACTER_ANALYSIS,
        variables: { source_text: "source", character_library: "[]" },
      }),
      maxSemanticCorrections: 0,
    };

    await expect(
      requestOpenAiStructured({
        baseUrl: "https://provider.test/v1",
        apiKeys: ["first-key", "second-key"],
        model: "test-model",
        prompt,
        schema,
        validate: () => [
          { code: "VALUE_INVALID", path: "value", message: "always invalid" },
        ],
      }),
    ).rejects.toMatchObject({ code: "STRUCTURED_SEMANTIC_INVALID" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still rotates API keys for provider failures", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "unauthorized" }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(jsonResponse('{"value":7}'));
    vi.stubGlobal("fetch", fetchMock);
    const prompt = renderPrompt({
      id: PROMPT_IDS.STORY_CHARACTER_ANALYSIS,
      variables: { source_text: "source", character_library: "[]" },
    });

    const result = await requestOpenAiStructured({
      baseUrl: "https://provider.test/v1",
      apiKeys: ["bad-key", "good-key"],
      model: "test-model",
      prompt,
      schema,
    });

    expect(result.data).toEqual({ value: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer bad-key");
    expect(
      (fetchMock.mock.calls[1][1]?.headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer good-key");
  });

  it("does not reset the semantic budget when correction changes API key", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse('{"value":1}'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "temporary provider failure" }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(jsonResponse('{"value":1}'));
    vi.stubGlobal("fetch", fetchMock);
    const prompt = renderPrompt({
      id: PROMPT_IDS.STORY_CHARACTER_ANALYSIS,
      variables: { source_text: "source", character_library: "[]" },
    });

    await expect(
      requestOpenAiStructured({
        baseUrl: "https://provider.test/v1",
        apiKeys: ["first-key", "second-key"],
        model: "test-model",
        prompt,
        schema,
        validate: () => [
          { code: "VALUE_INVALID", path: "value", message: "always invalid" },
        ],
      }),
    ).rejects.toMatchObject({ code: "STRUCTURED_SEMANTIC_INVALID" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.map(
        (call) =>
          (call[1]?.headers as Record<string, string>).Authorization,
      ),
    ).toEqual(["Bearer first-key", "Bearer first-key", "Bearer second-key"]);
  });
});

function jsonResponse(
  content: string,
  usage?: Record<string, number>,
) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      ...(usage ? { usage } : {}),
    }),
    { status: 200 },
  );
}
