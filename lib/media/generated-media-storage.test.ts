import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadAndStoreMedia: vi.fn(),
  storeMediaBytes: vi.fn(),
  stripAudioFromVideoUrl: vi.fn(),
}));

vi.mock("@/lib/providers/local/ffmpeg-video", () => ({
  stripAudioFromVideoUrl: mocks.stripAudioFromVideoUrl,
}));

vi.mock("@/lib/storage", () => ({
  downloadAndStoreMedia: mocks.downloadAndStoreMedia,
  storeMediaBytes: mocks.storeMediaBytes,
}));

import { storeGeneratedMediaAsset } from "./generated-media-storage";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generated media storage", () => {
  it("stores a stripped storyboard video instead of the provider source", async () => {
    const stripped = Uint8Array.from([1, 2, 3]);
    mocks.stripAudioFromVideoUrl.mockResolvedValue(stripped);
    mocks.storeMediaBytes.mockResolvedValue("projects/p1/media/video/v1.mp4");

    const storageKey = await storeGeneratedMediaAsset({
      asset: {
        id: "video-1",
        kind: "video",
        url: "https://provider.test/video.mp4",
        mimeType: "video/mp4",
      },
      storageKey: "projects/p1/media/video/v1.mp4",
      stripVideoAudio: true,
    });

    expect(storageKey).toBe("projects/p1/media/video/v1.mp4");
    expect(mocks.stripAudioFromVideoUrl).toHaveBeenCalledWith(
      "https://provider.test/video.mp4",
    );
    expect(mocks.storeMediaBytes).toHaveBeenCalledWith(
      stripped,
      "projects/p1/media/video/v1.mp4",
      "video/mp4",
    );
    expect(mocks.downloadAndStoreMedia).not.toHaveBeenCalled();
  });

  it("keeps the normal download path when stripping is not required", async () => {
    mocks.downloadAndStoreMedia.mockResolvedValue(
      "projects/p1/media/video/v2.mp4",
    );

    await storeGeneratedMediaAsset({
      asset: {
        id: "video-2",
        kind: "video",
        url: "https://provider.test/lipsync.mp4",
        mimeType: "video/mp4",
      },
      storageKey: "projects/p1/media/video/v2.mp4",
      stripVideoAudio: false,
    });

    expect(mocks.downloadAndStoreMedia).toHaveBeenCalledTimes(1);
    expect(mocks.stripAudioFromVideoUrl).not.toHaveBeenCalled();
  });
});
