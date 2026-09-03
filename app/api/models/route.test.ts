import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  channelFindFirst: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  AdminRequiredError: class AdminRequiredError extends Error {},
  requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
}));

vi.mock("@/lib/server/crypto", () => ({
  decryptSecret: vi.fn(() => JSON.stringify(["stored-key"])),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { channel: { findFirst: mocks.channelFindFirst } },
}));

import { POST } from "./route";

beforeEach(() => {
  mocks.channelFindFirst.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("models route", () => {
  it("uses the saved channel key and ElevenLabs model response format", async () => {
    mocks.channelFindFirst.mockResolvedValue({
      baseUrl: "https://api.elevenlabs.io/v1",
      encryptedApiKeys: "ciphertext",
      protocol: "elevenlabs",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json([
        {
          model_id: "eleven_multilingual_v2",
          name: "Eleven Multilingual v2",
        },
        {
          model_id: "eleven_text_to_sound_v2",
          name: "Text to Sound Effects v2",
        },
      ]),
    );

    const response = await POST(
      new Request("http://localhost/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: "channel-elevenlabs",
          protocol: "elevenlabs",
          baseUrl: "https://api.elevenlabs.io/v1",
        }),
      }),
    );
    const payload = (await response.json()) as {
      models: Array<{
        id: string;
        modelId: string;
        name: string;
        type: string;
        capabilities: { maxDurationSeconds?: number; modalities: string[] };
      }>;
    };

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ "xi-api-key": "stored-key" }),
      }),
    );
    expect(payload.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "eleven_text_to_sound_v2",
          modelId: "eleven_text_to_sound_v2",
          name: "Text to Sound Effects v2",
          type: "audio",
          capabilities: expect.objectContaining({
            modalities: ["audio"],
            maxDurationSeconds: 30,
          }),
        }),
      ]),
    );
  });

  it("returns the built-in AutoDL workflow catalog without calling a foreign endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await POST(
      new Request("http://localhost/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: "autodl-comfyui",
          baseUrl: "https://autodl.art/api/v1",
          apiKey: "token",
        }),
      }),
    );
    const payload = (await response.json()) as {
      models: Array<{
        id: string;
        type: string;
        protocol: string;
        capabilities: { modalities: string[] };
      }>;
    };

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload.models).toHaveLength(8);
    expect(payload.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "minimax_h3_image_audio_to_video_v2_15s",
          type: "video",
          protocol: "autodl-comfyui",
        }),
        expect.objectContaining({
          id: "indextts2-v1",
          type: "audio",
          capabilities: expect.objectContaining({ modalities: ["audio"] }),
        }),
      ]),
    );
  });

  it("returns the built-in Qwen-Audio Plus catalog without a paid request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await POST(
      new Request("http://localhost/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: "bailian-dashscope",
          baseUrl:
            "https://workspace-1.cn-beijing.maas.aliyuncs.com/api/v1",
          apiKey: "token",
        }),
      }),
    );
    const payload = (await response.json()) as {
      models: Array<{
        id: string;
        type: string;
        protocol: string;
        capabilities: { modalities: string[] };
      }>;
    };

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload.models).toEqual([
      expect.objectContaining({
        id: "qwen-audio-3.0-tts-plus",
        type: "audio",
        protocol: "bailian-dashscope",
        capabilities: expect.objectContaining({ modalities: ["audio"] }),
      }),
    ]);
  });
});
