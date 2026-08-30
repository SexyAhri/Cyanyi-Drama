import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  channelFindFirst: vi.fn(),
  episodeFindFirst: vi.fn(),
  listVoiceLines: vi.fn(),
  novelCharacterFindMany: vi.fn(),
  providerModelFindFirst: vi.fn(),
  requestOpenAiStructured: vi.fn(),
  storyboardPanelFindMany: vi.fn(),
  transactionVoiceLineFindMany: vi.fn(),
  voiceLineFindMany: vi.fn(),
  voiceLineUpdate: vi.fn(),
}));

vi.mock("@/lib/llm/openai-structured", () => ({
  requestOpenAiStructured: mocks.requestOpenAiStructured,
}));
vi.mock("@/lib/production/domain-store", () => ({
  listVoiceLines: mocks.listVoiceLines,
}));
vi.mock("@/lib/server/channel-access", () => ({
  accessibleChannelWhere: vi.fn(() => ({})),
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
  }),
}));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    episode: { findFirst: mocks.episodeFindFirst },
    voiceLine: { findMany: mocks.voiceLineFindMany },
    novelCharacter: { findMany: mocks.novelCharacterFindMany },
    storyboardPanel: { findMany: mocks.storyboardPanelFindMany },
    channel: { findFirst: mocks.channelFindFirst },
    providerModel: { findFirst: mocks.providerModelFindFirst },
    $transaction: async (callback: (tx: unknown) => Promise<void>) =>
      callback({
        voiceLine: {
          findMany: mocks.transactionVoiceLineFindMany,
          update: mocks.voiceLineUpdate,
        },
      }),
  },
}));

import {
  designEpisodeVoicePerformance,
  validateVoicePerformanceDesign,
} from "./design";

const sourceLines = [
  {
    id: "line-1",
    lineIndex: 0,
    speaker: "林岚",
    content: "别回头。",
    delivery: "dialogue",
    matchedPanelId: "panel-1",
  },
  {
    id: "line-2",
    lineIndex: 1,
    speaker: "林岚",
    content: "继续往前走。",
    delivery: "dialogue",
    matchedPanelId: "panel-1",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.episodeFindFirst.mockResolvedValue({
    novelText: "追兵逼近，林岚压低声音提醒同伴。",
  });
  mocks.voiceLineFindMany.mockResolvedValue(sourceLines);
  mocks.transactionVoiceLineFindMany.mockResolvedValue(sourceLines);
  mocks.novelCharacterFindMany.mockResolvedValue([
    {
      name: "林岚",
      aliases: "[]",
      introduction: "年轻侦察员",
      profileJson: JSON.stringify({ temperament: "冷静" }),
    },
  ]);
  mocks.storyboardPanelFindMany.mockResolvedValue([
    {
      id: "panel-1",
      panelIndex: 0,
      sceneNumber: 1,
      description: "林岚侧耳判断追兵距离，压低声音。",
      speakingCharacter: "林岚",
      lipSyncText: "别回头。继续往前走。",
      voiceoverText: null,
      actingNotesJson: JSON.stringify([{ emotion: "克制的紧张" }]),
      motionBeatsJson: "[]",
      startStateJson: null,
      endStateJson: null,
      sourceEvidenceJson: "[]",
    },
  ]);
  mocks.channelFindFirst.mockResolvedValue({
    protocol: "openai-compatible",
    baseUrl: "https://provider.test/v1",
    encryptedApiKeys: '["key-1"]',
  });
  mocks.providerModelFindFirst.mockResolvedValue({
    capabilitiesJson: JSON.stringify({ supportsStructuredOutputs: true }),
  });
  mocks.requestOpenAiStructured.mockResolvedValue({
    data: {
      speakers: [
        {
          speaker: "林岚",
          voiceProfilePrompt:
            "年轻女性中音，音色清亮但收束，咬字利落，呼吸稳定，避免播音腔。",
        },
      ],
      lines: [
        {
          lineId: "line-1",
          emotionPrompt:
            "对同伴低声警告，音量压低，语速偏慢，在“回头”前略停，句尾短促收住。",
          emotionStrength: 0.72,
        },
        {
          lineId: "line-2",
          emotionPrompt:
            "延续上一句的克制紧张，语速稍加快，重读“继续”，保持低音量并留出急促气口。",
          emotionStrength: 0.78,
        },
      ],
    },
    trace: { promptId: "story_voice_performance_design" },
  });
  mocks.voiceLineUpdate.mockResolvedValue({});
  mocks.listVoiceLines.mockResolvedValue([{ id: "line-1" }, { id: "line-2" }]);
});

describe("AI voice performance design", () => {
  it("grounds a stable speaker profile and persists every line direction", async () => {
    const result = await designEpisodeVoicePerformance({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      channelId: "channel-1",
      model: "analysis-model",
      locale: "zh",
    });

    const request = mocks.requestOpenAiStructured.mock.calls[0][0];
    const generated = await mocks.requestOpenAiStructured.mock.results[0].value;
    expect(request.prompt.text).toContain("别回头。");
    expect(request.prompt.text).toContain("克制的紧张");
    expect(request.validate(generated.data)).toEqual([]);
    expect(mocks.voiceLineUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.voiceLineUpdate).toHaveBeenCalledWith({
      where: { id: "line-1" },
      data: expect.objectContaining({
        voiceProfilePrompt: expect.stringContaining("音色清亮"),
        emotionPrompt: expect.stringContaining("低声警告"),
        emotionStrength: 0.72,
      }),
    });
    expect(result.promptTrace).toEqual({
      promptId: "story_voice_performance_design",
    });
  });

  it("rejects missing, duplicated, and unexpected coverage", () => {
    const issues = validateVoicePerformanceDesign(
      {
        speakers: [
          { speaker: "林岚", voiceProfilePrompt: "足够长的角色声线设计描述，用于测试覆盖校验。" },
          { speaker: "林岚", voiceProfilePrompt: "重复的角色声线设计描述，用于测试覆盖校验。" },
        ],
        lines: [
          {
            lineId: "line-1",
            emotionPrompt: "足够长的逐句表演设计描述，用于测试精确覆盖校验。",
            emotionStrength: 0.5,
          },
          {
            lineId: "unknown",
            emotionPrompt: "额外台词的逐句表演设计描述，用于测试精确覆盖校验。",
            emotionStrength: 0.5,
          },
        ],
      },
      { speakers: ["林岚", "韩宇"], lineIds: ["line-1", "line-2"] },
    );

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "VOICE_DESIGN_COVERAGE_MISSING",
        "VOICE_DESIGN_COVERAGE_UNEXPECTED",
        "VOICE_DESIGN_COVERAGE_DUPLICATE",
      ]),
    );
  });
});
