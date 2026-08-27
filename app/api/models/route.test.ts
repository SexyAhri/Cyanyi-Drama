import { describe, expect, it, vi } from "vitest";

import { POST } from "./route";

describe("models route", () => {
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
});
