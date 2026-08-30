import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithProviderRetry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/providers/http", () => ({ fetchWithProviderRetry }));

import { volcengineArkMediaProvider } from "./volcengine-ark";

beforeEach(() => {
  vi.clearAllMocks();
  fetchWithProviderRetry.mockResolvedValue(
    Response.json({ content: { video_url: "https://cdn.test/shot.mp4" } }),
  );
});

describe("Volcengine Ark video audio policy", () => {
  it.each([
    ["ambient_only", true],
    ["none", false],
  ] as const)("maps %s to generate_audio=%s", async (audioMode, generateAudio) => {
    await volcengineArkMediaProvider.generate({
      protocol: "volcengine-ark",
      providerKey: "volcengine",
      baseUrl: "https://ark.test/api/v3",
      apiKey: "key-1",
      model: "video-model",
      kind: "video",
      request: {
        prompt: "生成与动作同步的环境声和动作音效，不生成人声",
        duration: "5s",
        audioMode,
      },
    });

    const body = JSON.parse(fetchWithProviderRetry.mock.calls[0][1].body as string);
    expect(body.generate_audio).toBe(generateAudio);
  });
});
