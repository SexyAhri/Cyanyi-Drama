import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const mocks = vi.hoisted(() => ({ provider: vi.fn() }));
vi.mock("@/lib/episodes/provider", () => ({ resolveEpisodeTextProvider: mocks.provider }));
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
  it("isolates concurrent tasks with different frozen configuration versions", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"value":1}' } }] }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    const request = (version: number) => withProductionConfiguration("owner", { ...mergeProductionConfigurations([{ agents: { [input.prompt.id]: { systemInstructions: `snapshot-${version}` } } }]), format: "production-configuration-v1", sources: [{ scopeKey: "user", version }] }, () => requestOpenAiStructured(input));
    const results = await Promise.all([request(1), request(2)]);
    expect(results.map(result => result.trace.configurationSources?.[0].version)).toEqual([1, 2]);
    expect(fetchMock.mock.calls.map(call => JSON.parse(call[1].body).messages[0].content)).toEqual([expect.stringContaining("snapshot-1"), expect.stringContaining("snapshot-2")]);
  });
});
