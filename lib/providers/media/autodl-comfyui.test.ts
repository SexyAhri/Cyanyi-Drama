import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithProviderRetry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/providers/http", () => ({ fetchWithProviderRetry }));

import { autoDlComfyUiMediaProvider } from "./autodl-comfyui";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void) => {
    callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
});

describe("AutoDL ComfyUI media provider", () => {
  it("submits and polls an H3 multi-reference workflow with raw token auth", async () => {
    fetchWithProviderRetry
      .mockResolvedValueOnce(
        Response.json({
          code: "Success",
          data: { task_id: "task-1", status: "QUEUED" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: "Success",
          data: {
            task_id: "task-1",
            status: "SUCCESS",
            results: [
              { url: "https://cdn.test/result.mp4", type: "video", file_type: "mp4" },
            ],
          },
        }),
      );

    const result = await autoDlComfyUiMediaProvider.generate({
      protocol: "autodl-comfyui",
      providerKey: "autodl",
      baseUrl: "https://autodl.art/api/v1",
      apiKey: "token-value",
      model: "minimax_h3_image_audio_to_video_v2_15s",
      kind: "video",
      request: {
        prompt: "角色说完台词后推镜",
        ratio: "16:9",
        resolution: "768p",
        duration: "15s",
        referenceImages: [{ url: "https://cdn.test/shot.png" }],
        referenceAudios: [{ url: "https://cdn.test/dialogue.wav" }],
      },
    });

    expect(fetchWithProviderRetry).toHaveBeenCalledTimes(2);
    expect(fetchWithProviderRetry.mock.calls[0][0]).toBe(
      "https://autodl.art/api/v1/comfyui/comfyui_workflow/minimax_h3_image_audio_to_video_v2_15s",
    );
    expect(fetchWithProviderRetry.mock.calls[0][1].headers).toMatchObject({
      Authorization: "token-value",
    });
    expect(JSON.parse(fetchWithProviderRetry.mock.calls[0][1].body)).toEqual({
      prompt: "角色说完台词后推镜",
      duration: 15,
      resolution: "768p横",
      ref_image_0: "https://cdn.test/shot.png",
      ref_audio_0: "https://cdn.test/dialogue.wav",
    });
    expect(fetchWithProviderRetry.mock.calls[1][0]).toBe(
      "https://autodl.art/api/v1/comfyui/comfyui_workflow/result/task-1",
    );
    expect(result[0]).toMatchObject({
      kind: "video",
      url: "https://cdn.test/result.mp4",
      mimeType: "video/mp4",
      metadata: { providerTaskId: "task-1" },
    });
  });

  it("maps IndexTTS2 reference voice and emotion fields", async () => {
    fetchWithProviderRetry
      .mockResolvedValueOnce(
        Response.json({ code: "Success", data: { task_id: "tts-1" } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: "Success",
          data: {
            status: "completed",
            results: [
              { url: "https://cdn.test/voice.wav", type: "audio", file_type: "wav" },
            ],
          },
        }),
      );

    await autoDlComfyUiMediaProvider.generate({
      protocol: "autodl-comfyui",
      providerKey: "autodl",
      baseUrl: "https://autodl.art",
      apiKey: "tts-token",
      model: "indextts2-v1",
      kind: "audio",
      request: {
        input: "别回头。",
        emotionPrompt: "愤怒",
        emotionStrength: 0.8,
        referenceAudios: [{ url: "https://cdn.test/voice-reference.wav" }],
      },
    });

    expect(fetchWithProviderRetry.mock.calls[0][0]).toBe(
      "https://autodl.art/api/v1/comfyui/comfyui_workflow/indextts2-v1",
    );
    expect(JSON.parse(fetchWithProviderRetry.mock.calls[0][1].body)).toMatchObject({
      prompt_text: "别回头。",
      prompt_simple: "https://cdn.test/voice-reference.wav",
      emo_ref_audio: "https://cdn.test/voice-reference.wav",
      emo_control_method: "使用情感参考音频",
      emo_angry: 0.8,
      emo_calm: 0,
    });
  });

  it("surfaces the workflow failure reason", async () => {
    fetchWithProviderRetry
      .mockResolvedValueOnce(
        Response.json({ code: "Success", data: { task_id: "failed-1" } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: "Success",
          data: { status: "FAILED", message: "reference audio cannot be read" },
        }),
      );

    await expect(
      autoDlComfyUiMediaProvider.generate({
        protocol: "autodl-comfyui",
        providerKey: "autodl",
        baseUrl: "https://autodl.art/api/v1",
        apiKey: "token",
        model: "minimax_h3_lightx2v_no_pic",
        kind: "video",
        request: { prompt: "slow dolly in" },
      }),
    ).rejects.toThrow(
      "AUTODL_WORKFLOW_FAILED:minimax_h3_lightx2v_no_pic:reference audio cannot be read",
    );
  });
});
