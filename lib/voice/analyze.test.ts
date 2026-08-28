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
vi.mock("@/lib/settings/runtime-store", () => ({
  loadUserRuntimeSettings: vi.fn().mockResolvedValue({
    structuredRequestTimeoutSeconds: 600,
    structuredOutputStreaming: true,
    structuredTransportMaxAttempts: 3,
    workflowStepMaxAttempts: 3,
    workflowConcurrency: 2,
    screenplayClipMaxChars: 1_600,
  }),
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
  buildScreenplayVoiceAnalysis,
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

  it("uses dialogue attribution after a quote instead of a nearby character", () => {
    const sourceText = "父亲看向门口。“我回来了。”韩宇轻声说道。";
    const data = buildDeterministicVoiceAnalysis({
      sourceText,
      characters: [
        { name: "父亲", aliases: [] },
        { name: "韩宇", aliases: [] },
      ],
      panels: [],
    });

    expect(data.lines[0]).toMatchObject({
      speaker: "韩宇",
      content: "我回来了。",
    });
  });

  it("uses screenplay dialogue instead of reinterpreting narrative prose", () => {
    const data = buildScreenplayVoiceAnalysis({
      clips: [
        {
          id: "clip-1",
          screenplay: JSON.stringify({
            clipId: "clip-1",
            originalText:
              "若自己没有重伤，韩宇本可早早突破。韩宇反而安慰父亲，只要坚持，终有一天能让轻视他们的人闭嘴。",
            scenes: [
              {
                sceneNumber: 0,
                heading: { intExt: "INT", location: "书房", time: "夜" },
                description: "",
                characters: ["韩宇"],
                content: [
                  {
                    type: "action",
                    text:
                      "若自己没有重伤，韩宇本可早早突破。韩宇反而安慰父亲，只要坚持，终有一天能让轻视他们的人闭嘴。",
                  },
                ],
              },
            ],
          }),
        },
      ],
      panels: [
        {
          clipId: "clip-1",
          panelIndex: 2,
          description: "韩宇安慰父亲。",
          subtitleText: "",
          speakingCharacter: "韩宇",
          lipSyncText: "只要坚持，终有一天能让轻视他们的人闭嘴。",
        },
      ],
    });

    expect(data?.lines).toEqual([
      expect.objectContaining({
        speaker: "韩宇",
        content: "只要坚持，终有一天能让轻视他们的人闭嘴。",
        matchedPanelIndex: 2,
      }),
    ]);
  });

  it("uses the deterministic storyboard split for independent voice lines", () => {
    const fullText =
      "你以为凭这点修为就能挡住我吗？今日我便让你看清境界之间不可逾越的差距！";
    const first = "你以为凭这点修为就能挡住我吗？";
    const second = "今日我便让你看清境界之间不可逾越的差距！";
    const data = buildScreenplayVoiceAnalysis({
      clips: [
        {
          id: "clip-1",
          screenplay: JSON.stringify({
            clipId: "clip-1",
            originalText: `甲说：“${fullText}”`,
            scenes: [
              {
                sceneNumber: 0,
                heading: { intExt: "EXT", location: "演武场", time: "日" },
                description: "",
                characters: ["甲"],
                content: [
                  {
                    type: "dialogue",
                    character: "甲",
                    parenthetical: null,
                    lines: fullText,
                  },
                ],
              },
            ],
          }),
        },
      ],
      panels: [
        {
          clipId: "clip-1",
          panelIndex: 8,
          description: "甲开口",
          subtitleText: "",
          speakingCharacter: "甲",
          lipSyncText: first,
        },
        {
          clipId: "clip-1",
          panelIndex: 9,
          description: "甲继续说",
          subtitleText: "",
          speakingCharacter: "甲",
          lipSyncText: second,
        },
      ],
    });

    expect(data?.lines.map((line) => [line.content, line.matchedPanelIndex])).toEqual([
      [first, 8],
      [second, 9],
    ]);
  });

  it("does not silently drop a clip whose screenplay is missing", () => {
    const data = buildScreenplayVoiceAnalysis({
      clips: [
        {
          id: "clip-1",
          screenplay: JSON.stringify({
            clipId: "clip-1",
            originalText: "甲说：你好。",
            scenes: [
              {
                sceneNumber: 0,
                heading: { intExt: "INT", location: "书房", time: "日" },
                description: "",
                characters: ["甲"],
                content: [
                  {
                    type: "dialogue",
                    character: "甲",
                    parenthetical: null,
                    lines: "你好",
                  },
                ],
              },
            ],
          }),
        },
        { id: "clip-2", screenplay: null },
      ],
      panels: [],
    });

    expect(data).toBeNull();
  });

  it("extracts explicitly attributed unquoted direct speech", () => {
    const sourceText = "韩宇安慰父亲，只要坚持，终有一天会好起来。";
    const data = buildDeterministicVoiceAnalysis({
      sourceText,
      characters: [{ name: "韩宇", aliases: [] }],
      panels: [],
    });

    expect(data.lines).toEqual([
      expect.objectContaining({
        speaker: "韩宇",
        content: "只要坚持，终有一天会好起来。",
      }),
    ]);
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
