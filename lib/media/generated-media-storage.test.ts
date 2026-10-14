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
  vi.unstubAllGlobals();
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
    mocks.storeMediaBytes.mockResolvedValue("projects/p1/media/video/v2.mp4");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Uint8Array.from([4, 5, 6]), {
      status: 200,
      headers: { "Content-Type": "video/mp4" },
    })));
    const phases: string[] = [];

    const stored = await storeGeneratedMediaAsset({
      asset: {
        id: "video-2",
        kind: "video",
        url: "https://provider.test/lipsync.mp4",
        mimeType: "video/mp4",
      },
      storageKey: "projects/p1/media/video/v2.mp4",
      stripVideoAudio: false,
      onExecutionPhase: async phase => { phases.push(phase); },
    });

    expect(stored).toBe("projects/p1/media/video/v2.mp4");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(mocks.storeMediaBytes).toHaveBeenCalledWith(
      Uint8Array.from([4, 5, 6]),
      "projects/p1/media/video/v2.mp4",
      "video/mp4",
    );
    expect(phases).toEqual(["downloading", "saving"]);
    expect(mocks.stripAudioFromVideoUrl).not.toHaveBeenCalled();
  });

  it("aborts a timed out provider-result download before saving", async () => {
    const controller = new AbortController();
    controller.abort(new Error("MEDIA_PHASE_TIMEOUT:downloading"));
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) return Promise.reject(init.signal.reason);
      return Promise.resolve(new Response(new Uint8Array([1]), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const phases: string[] = [];

    await expect(storeGeneratedMediaAsset({
      asset: { id: "video-3", kind: "video", url: "https://provider.test/slow.mp4", mimeType: "video/mp4" },
      storageKey: "projects/p1/media/video/v3.mp4",
      stripVideoAudio: false,
      signal: controller.signal,
      onExecutionPhase: async phase => { phases.push(phase); },
    })).rejects.toThrow("MEDIA_PHASE_TIMEOUT:downloading");

    expect(phases).toEqual(["downloading"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.storeMediaBytes).not.toHaveBeenCalled();
  });
});
