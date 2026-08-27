import { beforeEach, describe, expect, it, vi } from "vitest";

const requestOpenAiStructured = vi.hoisted(() => vi.fn());
const episodeFindFirst = vi.hoisted(() => vi.fn());
const channelFindFirst = vi.hoisted(() => vi.fn());
const providerModelFindFirst = vi.hoisted(() => vi.fn());
const novelCharacterFindMany = vi.hoisted(() => vi.fn());
const voiceLineDeleteMany = vi.hoisted(() => vi.fn());
const voiceLineCreateMany = vi.hoisted(() => vi.fn());
const voiceLineFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/llm/openai-structured", () => ({
  requestOpenAiStructured,
  isRetryableStructuredProviderError: (error: unknown) =>
    error instanceof Error &&
    (/^STRUCTURED_PROVIDER_TIMEOUT:/.test(error.message) ||
      /^STRUCTURED_PROVIDER_FAILED:(408|425|429|5\d\d):/.test(error.message)),
}));
vi.mock("@/lib/server/crypto", () => ({
  decryptSecret: (value: string) => value,
}));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    episode: { findFirst: episodeFindFirst },
    channel: { findFirst: channelFindFirst },
    providerModel: { findFirst: providerModelFindFirst },
    novelCharacter: { findMany: novelCharacterFindMany },
    voiceLine: { findMany: voiceLineFindMany },
    $transaction: async (callback: (tx: unknown) => Promise<void>) =>
      callback({
        voiceLine: {
          deleteMany: voiceLineDeleteMany,
          createMany: voiceLineCreateMany,
        },
      }),
  },
}));

import { validateVoiceAnalysis } from "@/lib/prompts/validators";
import {
  analyzeEpisodeVoices,
  buildDeterministicVoiceAnalysis,
  VoiceAnalyzeError,
} from "./analyze";

const input = {
  userId: "user-1",
  projectId: "project-1",
  episodeId: "episode-1",
  channelId: "channel-1",
  model: "model-1",
  locale: "zh" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  episodeFindFirst.mockResolvedValue({
    id: "episode-1",
    novelText: "甲看向门口，说：“你好。”乙回答：“进来吧。”",
    storyboard: {
      panels: [
        {
          id: "panel-1",
          panelIndex: 0,
          description: "甲说你好。",
          subtitleText: null,
        },
      ],
    },
  });
  channelFindFirst.mockResolvedValue({
    protocol: "openai-compatible",
    baseUrl: "https://provider.test/v1",
    encryptedApiKeys: '["key-1"]',
  });
  providerModelFindFirst.mockResolvedValue({
    modelId: "model-1",
    capabilitiesJson: "{}",
  });
  novelCharacterFindMany.mockResolvedValue([
    { name: "甲", aliases: "[]", profileJson: "{}", introduction: null },
    { name: "乙", aliases: "[]", profileJson: "{}", introduction: null },
  ]);
  voiceLineDeleteMany.mockResolvedValue({ count: 0 });
  voiceLineCreateMany.mockResolvedValue({ count: 2 });
  voiceLineFindMany.mockResolvedValue([
    { id: "line-1", speaker: "甲", content: "你好。" },
    { id: "line-2", speaker: "乙", content: "进来吧。" },
  ]);
});

describe("voice analysis", () => {
  it("builds exact-source canonical dialogue lines", () => {
    const sourceText = "甲说：“你好。”乙回答：“进来吧。”";
    const data = buildDeterministicVoiceAnalysis({
      sourceText,
      characters: [
        { name: "甲", aliases: [] },
        { name: "乙", aliases: [] },
      ],
      panels: [{ panelIndex: 0, description: "甲说你好。", subtitleText: "" }],
    });

    expect(data.lines.map((line) => [line.speaker, line.content])).toEqual([
      ["甲", "你好。"],
      ["乙", "进来吧。"],
    ]);
    expect(
      validateVoiceAnalysis(data, {
        sourceText,
        characters: ["甲", "乙"],
        panelIndices: [0],
      }),
    ).toEqual([]);
  });

  it("persists deterministic lines after a provider timeout", async () => {
    requestOpenAiStructured.mockRejectedValue(
      new Error("STRUCTURED_PROVIDER_TIMEOUT:120000"),
    );

    const result = await analyzeEpisodeVoices(input);

    expect(result).toMatchObject({
      degraded: true,
      fallbackReason: "PROVIDER_TIMEOUT",
      promptTraces: [],
    });
    expect(voiceLineCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ speaker: "甲", content: "你好。" }),
        expect.objectContaining({ speaker: "乙", content: "进来吧。" }),
      ]),
    });
  });

  it("does not hide non-retryable provider errors", async () => {
    requestOpenAiStructured.mockRejectedValue(
      new Error("STRUCTURED_PROVIDER_FAILED:400:invalid request"),
    );

    await expect(analyzeEpisodeVoices(input)).rejects.toBeInstanceOf(
      VoiceAnalyzeError,
    );
    expect(voiceLineCreateMany).not.toHaveBeenCalled();
  });
});
