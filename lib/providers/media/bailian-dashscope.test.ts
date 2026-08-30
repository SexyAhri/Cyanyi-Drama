import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithProviderRetry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/providers/http", () => ({ fetchWithProviderRetry }));

import {
  bailianDashScopeMediaProvider,
  buildQwenAudioTtsRequest,
} from "./bailian-dashscope";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Alibaba Cloud Model Studio Qwen-Audio TTS provider", () => {
  it("uses the Workspace SpeechSynthesizer contract and singular instruction", async () => {
    fetchWithProviderRetry.mockResolvedValue(
      Response.json({
        request_id: "request-1",
        output: {
          finish_reason: "stop",
          audio: {
            data: "",
            url: "https://dashscope-result.test/voice.wav?token=temporary",
            id: "audio-1",
            expires_at: 1_772_697_707,
          },
        },
        usage: { characters: 8 },
      }),
    );

    const result = await bailianDashScopeMediaProvider.generate({
      protocol: "bailian-dashscope",
      providerKey: "alibaba-bailian",
      baseUrl: "https://workspace-1.cn-beijing.maas.aliyuncs.com/api/v1",
      apiKey: "bailian-key",
      model: "qwen-audio-3.0-tts-plus",
      kind: "audio",
      request: {
        input: "不要回头。",
        voice: "longanlufeng",
        responseFormat: "wav",
        emotionPrompt: "压低音量，语速偏慢，带着克制的紧张感。",
        optimizeInstructions: true,
      },
    });

    expect(fetchWithProviderRetry).toHaveBeenCalledTimes(1);
    expect(fetchWithProviderRetry.mock.calls[0][0]).toBe(
      "https://workspace-1.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
    );
    expect(fetchWithProviderRetry.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer bailian-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(fetchWithProviderRetry.mock.calls[0][1].body)).toEqual({
      model: "qwen-audio-3.0-tts-plus",
      input: {
        text: "不要回头。",
        voice: "longanlufeng",
        format: "wav",
        sample_rate: 24000,
        instruction: "压低音量，语速偏慢，带着克制的紧张感。",
        optimize_instructions: true,
      },
    });
    expect(result[0]).toMatchObject({
      kind: "audio",
      url: "https://dashscope-result.test/voice.wav?token=temporary",
      mimeType: "audio/wav",
      metadata: {
        protocol: "bailian-dashscope",
        requestId: "request-1",
        audioId: "audio-1",
        expiresAt: 1_772_697_707,
        usage: { characters: 8 },
      },
    });
  });

  it("uses a Plus-compatible default voice without Qwen3-only fields", () => {
    expect(
      buildQwenAudioTtsRequest("qwen-audio-3.0-tts-plus", {
        input: "测试默认音色。",
        instructions: "沉稳、清晰。",
      }),
    ).toEqual({
      model: "qwen-audio-3.0-tts-plus",
      input: {
        text: "测试默认音色。",
        voice: "longanlingxin",
        format: "mp3",
        sample_rate: 24000,
        instruction: "沉稳、清晰。",
      },
    });
  });

  it("rejects an unresolved Workspace placeholder before making a request", async () => {
    await expect(
      bailianDashScopeMediaProvider.generate({
        protocol: "bailian-dashscope",
        providerKey: "alibaba-bailian",
        baseUrl:
          "https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/api/v1",
        apiKey: "bailian-key",
        model: "qwen-audio-3.0-tts-plus",
        kind: "audio",
        request: { input: "测试。" },
      }),
    ).rejects.toThrow("BAILIAN_TTS_WORKSPACE_ID_REQUIRED");
    expect(fetchWithProviderRetry).not.toHaveBeenCalled();
  });
});
