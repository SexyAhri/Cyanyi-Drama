import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithProviderRetry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/providers/http", () => ({ fetchWithProviderRetry }));

import {
  mediaAssetMetadata,
  generateImage,
  isSourceMediaDownloadFailure,
  mediaAssetExtension,
} from "./media-runtime";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("image generation runtime", () => {
  it("distinguishes broken provider URLs from storage upload failures", () => {
    expect(
      isSourceMediaDownloadFailure(new Error("MEDIA_DOWNLOAD_FAILED:404")),
    ).toBe(true);
    expect(isSourceMediaDownloadFailure(new Error("fetch failed"))).toBe(true);
    expect(
      isSourceMediaDownloadFailure(new Error("S3_BUCKET must be configured.")),
    ).toBe(false);
  });

  it("uses the provider MIME type for generated media storage", () => {
    expect(
      mediaAssetExtension({
        kind: "audio",
        mimeType: "audio/wav",
        url: "https://provider.test/result",
      }),
    ).toBe("wav");
    expect(
      mediaAssetExtension({
        kind: "image",
        mimeType: "image/jpeg; charset=binary",
        url: "https://provider.test/result",
      }),
    ).toBe("jpg");
  });

  it("does not duplicate inline media bytes into asset metadata", () => {
    expect(
      mediaAssetMetadata({
        url: "data:audio/mpeg;base64,AQID",
        metadata: { operation: "merge_episode_audio" },
      }),
    ).toEqual({ operation: "merge_episode_audio" });
    expect(
      mediaAssetMetadata({
        url: "https://provider.test/result.mp4",
        metadata: { model: "video-1" },
      }),
    ).toEqual({
      model: "video-1",
      originalUrl: "https://provider.test/result.mp4",
    });
  });

  it("does not hide unrelated provider failures", async () => {
    fetchWithProviderRetry.mockResolvedValue(
      Response.json({ error: { message: "quota exhausted" } }, { status: 429 }),
    );

    await expect(
      generateImage(
        "https://provider.test/v1",
        "openai-compatible",
        "key-1",
        "gpt-image-2",
        {
          prompt: "shot",
          referenceImages: [{ url: "data:image/png;base64,AQID" }],
        },
      ),
    ).rejects.toThrow("quota exhausted");
    expect(fetchWithProviderRetry).toHaveBeenCalledTimes(1);
  });
});
