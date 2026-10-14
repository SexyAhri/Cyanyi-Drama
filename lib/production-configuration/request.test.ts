import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const mocks = vi.hoisted(() => ({ provider: vi.fn(), prices: vi.fn() }));
vi.mock("@/lib/episodes/provider", () => ({ resolveEpisodeTextProvider: mocks.provider }));
vi.mock("@/lib/server/prisma", () => ({ prisma: { modelPrice: { findMany: mocks.prices } } }));
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { withProductionConfiguration } from "./context";
import { mergeProductionConfigurations } from "./contract";
const input = { baseUrl: "https://default.test/v1", apiKeys: ["default-key"], model: "default-model", stream: false,
  prompt: renderPrompt({ id: PROMPT_IDS.STORY_CHARACTER_ANALYSIS, variables: { source_text: "saved source", character_library: "[]" } }), schema: z.object({ value: z.number() }) };
describe("Agent configuration at the actual LLM request boundary", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
  it("sends the published model, instructions, template and parameters to the provider", async () => {
    mocks.provider.mockResolvedValue({ baseUrl: "https://configured.test/v1", apiKeys: ["configured-key"], model: "configured-model", structuredOutputMode: "json_schema" });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"value":7}' } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = { ...mergeProductionConfigurations([{ agents: { [input.prompt.id]: { channelId: "configured-channel", model: "configured-model", templateZh: "Review {{source_text}} from {{character_library}}", systemInstructions: "My published rule", temperature: 0.8 } }, workflow: { requestTimeoutSeconds: 30 } }]), format: "production-configuration-v1" as const, sources: [{ scopeKey: "project:p", version: 2 }] };
    const result = await withProductionConfiguration("owner", snapshot, () => requestOpenAiStructured(input));
    expect(mocks.provider).toHaveBeenCalledWith({ userId: "owner", channelId: "configured-channel", model: "configured-model" });
    const [url, request] = fetchMock.mock.calls[0]; const body = JSON.parse(request.body);
    expect(url).toBe("https://configured.test/v1/chat/completions"); expect(body).toMatchObject({ model: "configured-model", temperature: 0.8, response_format: { type: "json_schema" } });
    expect(body.messages[0].content).toContain("My published rule"); expect(body.messages[1].content).toBe("Review saved source from []");
    expect(result.trace).toMatchObject({ model: "configured-model", configurationSources: snapshot.sources });
    expect(result.trace.promptVersionHash).not.toBe(input.prompt.versionHash);
    await requestOpenAiStructured(input);
    expect(fetchMock.mock.calls[1][0]).toBe("https://default.test/v1/chat/completions");
  });
  it("uses configuration keyed by the actual production Agent identity", async () => {
    mocks.provider.mockResolvedValue({ baseUrl: "https://director.test/v1", apiKeys: ["configured-key"], model: "director-model", structuredOutputMode: "json_object" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"value":3}' } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const productionPrompt = { ...input.prompt, agentId: "production_storyboard-generation" };
    const snapshot = {
      ...mergeProductionConfigurations([{ agents: { "production_storyboard-generation": { channelId: "director-channel", model: "director-model", temperature: 0.4 } } }]),
      format: "production-configuration-v1" as const,
      sources: [{ scopeKey: "episode:e", version: 7 }],
    };
    const result = await withProductionConfiguration("owner", snapshot, () => requestOpenAiStructured({ ...input, prompt: productionPrompt }));
    expect(mocks.provider).toHaveBeenCalledWith({ userId: "owner", channelId: "director-channel", model: "director-model" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: "director-model", temperature: 0.4 });
    expect(result.trace).toMatchObject({ agentId: "production_storyboard-generation", model: "director-model", configurationSources: snapshot.sources });
  });
  it("isolates concurrent tasks with different frozen configuration versions", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"value":1}' } }] }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    const request = (version: number) => withProductionConfiguration("owner", { ...mergeProductionConfigurations([{ agents: { [input.prompt.id]: { systemInstructions: `snapshot-${version}` } } }]), format: "production-configuration-v1", sources: [{ scopeKey: "user", version }] }, () => requestOpenAiStructured(input));
    const results = await Promise.all([request(1), request(2)]);
    expect(results.map(result => result.trace.configurationSources?.[0].version)).toEqual([1, 2]);
    expect(fetchMock.mock.calls.map(call => JSON.parse(call[1].body).messages[0].content)).toEqual([expect.stringContaining("snapshot-1"), expect.stringContaining("snapshot-2")]);
  });

  it("switches to the configured fallback after a transient provider error and traces it", async () => {
    mocks.provider
      .mockResolvedValueOnce({ baseUrl: "https://primary.test/v1", apiKeys: ["primary-key"], model: "primary-model", provider: "primary-provider", structuredOutputMode: "json_schema" })
      .mockResolvedValueOnce({ baseUrl: "https://fallback.test/v1", apiKeys: ["fallback-key"], model: "fallback-model", provider: "fallback-provider", structuredOutputMode: "json_object" });
    mocks.prices.mockResolvedValue([]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"value":9}' } }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = {
      ...mergeProductionConfigurations([{ agents: { [input.prompt.id]: {
        channelId: "primary-channel", model: "primary-model",
        fallbackChannelId: "fallback-channel", fallbackModel: "fallback-model",
      } } }]),
      format: "production-configuration-v1" as const,
      sources: [{ scopeKey: "project:p", version: 3 }],
    };

    const result = await withProductionConfiguration("owner", snapshot, () => requestOpenAiStructured(input));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://primary.test/v1/chat/completions",
      "https://fallback.test/v1/chat/completions",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      model: "fallback-model",
      response_format: { type: "json_object" },
    });
    expect(result.trace).toMatchObject({
      model: "fallback-model",
      channelId: "fallback-channel",
      fallbackUsed: true,
      fallbackReason: "http_503",
      fallbackPriceCompatibility: "unknown",
      tokenUsage: { totalTokens: 6 },
    });
  });

  it("records when the configured fallback has a different known price", async () => {
    mocks.provider
      .mockResolvedValueOnce({ baseUrl: "https://primary.test/v1", apiKeys: ["primary-key"], model: "primary-model", provider: "primary-provider", structuredOutputMode: "json_schema" })
      .mockResolvedValueOnce({ baseUrl: "https://fallback.test/v1", apiKeys: ["fallback-key"], model: "fallback-model", provider: "fallback-provider", structuredOutputMode: "json_object" });
    mocks.prices.mockImplementation(async ({ where }: { where: { provider: string } }) => where.provider === "primary-provider"
      ? [{ unit: "input_tokens", unitPrice: { toString: () => "1" } }]
      : [{ unit: "input_tokens", unitPrice: { toString: () => "2" } }]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"value":5}' } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = {
      ...mergeProductionConfigurations([{ agents: { [input.prompt.id]: {
        channelId: "primary-channel", model: "primary-model",
        fallbackChannelId: "fallback-channel", fallbackModel: "fallback-model",
      } } }]),
      format: "production-configuration-v1" as const,
      sources: [{ scopeKey: "project:p", version: 4 }],
    };

    const result = await withProductionConfiguration("owner", snapshot, () => requestOpenAiStructured(input));
    expect(result.trace).toMatchObject({ fallbackUsed: true, fallbackReason: "http_503", fallbackPriceCompatibility: "different" });
    expect(mocks.prices).toHaveBeenCalledTimes(2);
  });

  it("does not silently switch models for authentication or parameter failures", async () => {
    mocks.provider
      .mockResolvedValueOnce({ baseUrl: "https://primary.test/v1", apiKeys: ["primary-key"], model: "primary-model", structuredOutputMode: "json_schema" })
      .mockResolvedValueOnce({ baseUrl: "https://fallback.test/v1", apiKeys: ["fallback-key"], model: "fallback-model", structuredOutputMode: "json_object" });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = {
      ...mergeProductionConfigurations([{ agents: { [input.prompt.id]: {
        channelId: "primary-channel", model: "primary-model",
        fallbackChannelId: "fallback-channel", fallbackModel: "fallback-model",
      } } }]),
      format: "production-configuration-v1" as const,
      sources: [{ scopeKey: "project:p", version: 3 }],
    };

    await expect(withProductionConfiguration("owner", snapshot, () => requestOpenAiStructured(input))).rejects.toThrow("STRUCTURED_PROVIDER_FAILED:401");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("blocks a fallback that cannot accept the original reference images", async () => {
    mocks.provider
      .mockResolvedValueOnce({ baseUrl: "https://primary.test/v1", apiKeys: ["primary-key"], model: "primary-model", structuredOutputMode: "json_schema", supportsReferenceImages: true })
      .mockResolvedValueOnce({ baseUrl: "https://fallback.test/v1", apiKeys: ["fallback-key"], model: "fallback-model", structuredOutputMode: "json_object", supportsReferenceImages: false });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = {
      ...mergeProductionConfigurations([{ agents: { [input.prompt.id]: {
        channelId: "primary-channel", model: "primary-model",
        fallbackChannelId: "fallback-channel", fallbackModel: "fallback-model",
      } } }]),
      format: "production-configuration-v1" as const,
      sources: [{ scopeKey: "project:p", version: 4 }],
    };

    await expect(withProductionConfiguration("owner", snapshot, () => requestOpenAiStructured({
      ...input,
      imageUrls: ["https://private.test/reference.png"],
    }))).rejects.toThrow("PRODUCTION_FALLBACK_INCOMPATIBLE:REFERENCE_IMAGES");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://primary.test/v1/chat/completions");
  });
});
