import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  channelFindFirst: vi.fn(),
  mediaTaskStoreCreate: vi.fn(),
  providerModelCount: vi.fn(),
  voiceLineFindFirst: vi.fn(),
  enqueuePersistedMediaTask: vi.fn(),
}));

vi.mock("@/lib/server/channel-access", () => ({
  accessibleChannelWhere: vi.fn(() => ({})),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    channel: { findFirst: mocks.channelFindFirst },
    providerModel: { count: mocks.providerModelCount },
    voiceLine: { findFirst: mocks.voiceLineFindFirst },
  },
}));

vi.mock("@/lib/storage", () => ({
  resolveStoredMediaUrl: vi.fn(),
}));

vi.mock("./task-store", () => ({
  createDatabaseMediaTaskStore: vi.fn(() => ({
    create: mocks.mediaTaskStoreCreate,
  })),
}));

vi.mock("./task-submit", () => ({
  enqueuePersistedMediaTask: mocks.enqueuePersistedMediaTask,
}));

import {
  buildVoiceInstructions,
  createVoiceLineAudioTask,
  resolveVoiceTaskVoice,
} from "./voice-tasks";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("voice task selection", () => {
  it("prefers an explicit voice, then an owned preset, then the model default", () => {
    const base = {
      lineSpeaker: "Narrator",
      projectId: "project-1",
      userId: "user-1",
      preset: {
        userId: "user-1",
        projectId: "project-1",
        providerVoiceId: "nova",
      },
    };
    expect(resolveVoiceTaskVoice({ ...base, explicitVoice: "alloy" })).toBe(
      "alloy",
    );
    expect(resolveVoiceTaskVoice(base)).toBe("nova");
    expect(
      resolveVoiceTaskVoice({
        ...base,
        preset: { ...base.preset, userId: "another-user" },
      }),
    ).toBeUndefined();
  });

  it("allows a global preset owned by the current user", () => {
    expect(
      resolveVoiceTaskVoice({
        lineSpeaker: "Narrator",
        projectId: "project-1",
        userId: "user-1",
        preset: {
          userId: "user-1",
          projectId: null,
          providerVoiceId: "shimmer",
        },
      }),
    ).toBe("shimmer");
  });

  it("preserves the approved voice and performance instruction in the audio task", async () => {
    mocks.channelFindFirst.mockResolvedValue({
      id: "channel-1",
      protocol: "bailian-dashscope",
      providerKey: "alibaba-bailian",
    });
    mocks.providerModelCount.mockResolvedValue(1);
    mocks.voiceLineFindFirst.mockResolvedValue({
      id: "line-1",
      content: "别回头。",
      speaker: "林岚",
      delivery: "dialogue",
      voiceProfilePrompt: "二十多岁女性，中音区清亮但克制，咬字利落。",
      emotionPrompt: "压低音量，语速偏慢，克制但紧张。",
      emotionStrength: 0.8,
      optimizeInstructions: true,
      voicePreset: {
        userId: "user-1",
        projectId: "project-1",
        providerVoiceId: "longanlingxin",
        sampleAsset: null,
      },
    });
    mocks.enqueuePersistedMediaTask.mockImplementation(
      (_userId: string, task: unknown) => task,
    );

    const result = await createVoiceLineAudioTask({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      lineId: "line-1",
      channelId: "channel-1",
      model: "qwen-audio-3.0-tts-plus",
    });

    expect(result.task).toMatchObject({
      protocol: "bailian-dashscope",
      model: "qwen-audio-3.0-tts-plus",
      request: {
        input: "别回头。",
        voice: "longanlingxin",
        responseFormat: "mp3",
        optimizeInstructions: true,
        emotionPrompt: "压低音量，语速偏慢，克制但紧张。",
        emotionStrength: 0.8,
        instructions: expect.stringContaining("表演：压低音量"),
      },
    });
    expect(result.task.request.input).toBe("别回头。");
    const queuedInstructions = result.task.request.instructions;
    expect(typeof queuedInstructions).toBe("string");
    expect(Array.from(String(queuedInstructions)).length).toBeLessThanOrEqual(
      240,
    );
    expect(mocks.mediaTaskStoreCreate).toHaveBeenCalledTimes(1);
    expect(mocks.enqueuePersistedMediaTask).toHaveBeenCalledTimes(1);
  });

  it("combines a stable character voice with line-specific performance controls", () => {
    const instruction = buildVoiceInstructions({
      speaker: "林岚",
      delivery: "dialogue",
      voiceProfilePrompt: "二十多岁女性，中音区清亮但克制，咬字利落。",
      performancePrompt:
        "面对追兵时压低音量，前半句放慢并短暂停顿，后半句带急促气息。",
      emotionStrength: 0.8,
    });

    expect(instruction).toContain("声线：二十多岁女性");
    expect(instruction).toContain("表演：面对追兵时压低音量");
    expect(instruction).toContain("强度：0.80");
    expect(instruction).toContain("仅输出干净人声");
    expect(Array.from(instruction).length).toBeLessThanOrEqual(240);
  });

  it("compacts legacy long directions before they reach the paid TTS request", () => {
    const instruction = buildVoiceInstructions({
      speaker: `林岚${"角色".repeat(30)}`,
      delivery: "dialogue",
      voiceProfilePrompt: `稳定声线。${"重复的角色背景和场景说明".repeat(40)}`,
      performancePrompt: `低声警告。${"重复的动作、关系和剧情复述".repeat(40)}`,
      emotionStrength: 0.8,
    });

    expect(Array.from(instruction).length).toBeLessThanOrEqual(240);
    expect(instruction).toContain("声线：稳定声线。");
    expect(instruction).toContain("表演：低声警告。");
    expect(instruction).toContain("仅输出干净人声");
    expect(instruction).not.toContain("重复的角色背景和场景说明".repeat(10));
  });
});
